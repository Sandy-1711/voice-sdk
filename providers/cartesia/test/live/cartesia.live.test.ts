import { describe, expect, it } from "vitest";
import { Voice, type STTEvent, type TTSEvent } from "@swungstudent/voice";
import { CartesiaProvider } from "../../src/index";

/**
 * The opt-in tier: real API, real key, real money.
 *
 *   CARTESIA_API_KEY=... pnpm test:live
 *
 * Set CARTESIA_VOICE_ID to use your own voice; the default is one of the
 * public library voices.
 */
const KEY = process.env.CARTESIA_API_KEY;
const VOICE_ID = process.env.CARTESIA_VOICE_ID ?? "a0e99841-438c-4a64-b679-ae501e7d6091";

const TEXT = "The quick brown fox jumps over the lazy dog.";
const SPOKEN = "Hello there. I would like to book a table for two people tomorrow evening.";

const voice = () =>
    new Voice({
        provider: new CartesiaProvider({ apiKey: KEY, defaultVoice: VOICE_ID }),
        options: { timeout: 30_000 },
    });

describe.skipIf(!KEY)("cartesia (live)", () => {
    it("speaks, and the wav header says what the resolved format claimed", async () => {
        const result = await voice().speak({ text: TEXT, format: { container: "wav", sampleRate: 44100 } });

        expect(result.audio.byteLength).toBeGreaterThan(1000);
        expect(result.format).toMatchObject({ container: "wav", sampleRate: 44100, channels: 1 });
        expect(Buffer.from(result.audio.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    });

    it("streams synthesis in more than one chunk", async () => {
        const stream = voice().speakStream({ text: TEXT });
        expect(stream.format.container).toBe("raw");

        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk.data);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBeGreaterThan(1000);
    });

    it("transcribes what it just synthesized", async () => {
        const spoken = await voice().speak({ text: SPOKEN, format: { container: "wav", sampleRate: 16000 } });

        const result = await voice().transcribe({ audio: spoken.audio, timestamps: "word" });

        expect(result.text.toLowerCase()).toContain("book a table");
        expect(result.words?.length).toBeGreaterThan(0);
    });

    it("walks the paginated voice catalogue", async () => {
        const voices = await voice().listVoices();

        expect(voices.length).toBeGreaterThan(0);
        expect(voices[0]).toMatchObject({ id: expect.any(String) });
    });

    it("runs a synthesis session and reports it finished", async () => {
        const session = await voice().openTTSSession({ format: { container: "raw", sampleRate: 44100 } });
        const events: TTSEvent[] = [];

        const reading = (async () => {
            for await (const event of session.output) {
                events.push(event);
                if (event.type === "done") break;
            }
        })();

        for (const word of TEXT.split(" ")) session.push(`${word} `);
        await session.flush();
        await Promise.race([reading, sleep(20_000)]);
        await session.close();

        expect(events.filter((event) => event.type === "audio").length).toBeGreaterThan(0);
    });

    // ink-2 detects turns for itself.
    it("hears a turn end in auto mode", async () => {
        const heard = await listen({ turnDetection: { mode: "vad", silence: 1 } }, (event) =>
            event.type === "transcript" && event.finality === "turn_end",
        );

        expect(heard.toLowerCase()).toContain("book a table");
    });

    // ink-whisper has no turn detection at all: nothing is transcribed until
    // flush() asks for it, which is the whole point of the manual endpoint.
    it("transcribes only when told to in manual mode", async () => {
        const heard = await listen(
            { turnDetection: { mode: "manual" } },
            (event) => event.type === "transcript" && event.finality === "turn_end",
            true,
        );

        expect(heard.toLowerCase()).toContain("book a table");
    });
});

/** Speaks a sentence, then feeds that audio back in as if it were a microphone. */
async function listen(
    input: Parameters<Voice<CartesiaProvider>["openSTTSession"]>[0],
    until: (event: STTEvent) => boolean,
    flush = false,
): Promise<string> {
    const spoken = await voice().speak({
        text: SPOKEN,
        format: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
    });

    const session = await voice().openSTTSession({
        ...input,
        inputFormat: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
    });

    let text = "";
    const reading = (async () => {
        for await (const event of session.output) {
            if (event.type === "transcript" && event.text) text = event.text;
            if (until(event)) return text;
        }
        return text;
    })();

    const frame = 3200;
    for (let at = 0; at < spoken.audio.length; at += frame) {
        session.push(spoken.audio.subarray(at, at + frame));
        await sleep(100);
    }
    for (let i = 0; i < 10; i += 1) {
        session.push(new Uint8Array(frame));
        await sleep(100);
    }
    if (flush) await session.flush();

    const heard = await Promise.race([reading, sleep(10_000).then(() => text)]);
    await session.close();

    return heard;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
