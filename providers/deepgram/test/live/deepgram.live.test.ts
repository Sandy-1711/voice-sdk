import { describe, expect, it } from "vitest";
import { Voice, type STTEvent, type TTSEvent } from "@voice-sdk/core";
import { DeepgramProvider } from "../../src/index";

/**
 * The opt-in tier: real API, real key, real money.
 *
 *   DEEPGRAM_API_KEY=... pnpm test:live
 *
 * Offline fakes only encode what we believe Deepgram's wire format is. This
 * tier is what catches it changing underneath us, so the assertions are about
 * shape and plausibility rather than exact bytes - the same text does not
 * synthesize to identical audio twice.
 */
const KEY = process.env.DEEPGRAM_API_KEY;

const TEXT = "The quick brown fox jumps over the lazy dog.";
const SPOKEN = "Hello there. I would like to book a table for two people tomorrow evening.";

const voice = () => new Voice({ provider: new DeepgramProvider({ apiKey: KEY }), options: { timeout: 30_000 } });

describe.skipIf(!KEY)("deepgram (live)", () => {
    it("speaks, and the wav header says what the resolved format claimed", async () => {
        const result = await voice().speak({ text: TEXT, format: { container: "wav", sampleRate: 24000 } });

        expect(result.audio.byteLength).toBeGreaterThan(1000);
        expect(result.format).toMatchObject({ container: "wav", sampleRate: 24000, channels: 1 });
        expect(Buffer.from(result.audio.subarray(0, 4)).toString("ascii")).toBe("RIFF");
        expect(result.requestId).toBeTruthy();
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
        const spoken = await voice().speak({
            text: SPOKEN,
            format: { container: "wav", sampleRate: 24000 },
        });

        const result = await voice().transcribe({ audio: spoken.audio, timestamps: "segment", diarize: true });

        expect(result.text.toLowerCase()).toContain("book a table");
        expect(result.duration).toBeGreaterThan(0);
        expect(result.words?.length).toBeGreaterThan(0);
        expect(result.segments?.length).toBeGreaterThan(0);
        expect(result.requestId).toBeTruthy();
    });

    it("runs a synthesis session and reports it finished", async () => {
        const session = await voice().openTTSSession({ format: { container: "raw", sampleRate: 24000 } });
        const events: TTSEvent[] = [];

        const reading = (async () => {
            for await (const event of session.output) {
                events.push(event);
                if (event.type === "done") break;
            }
        })();

        // Push like an LLM would: a token at a time.
        for (const word of TEXT.split(" ")) session.push(`${word} `);
        await session.flush();
        await reading;
        await session.close();

        const audio = events.filter((event) => event.type === "audio");
        expect(audio.length).toBeGreaterThan(0);
        expect(events.some((event) => event.type === "done")).toBe(true);
    });

    it("hears a turn end on nova-3", async () => {
        await expect(listen({ turnDetection: { mode: "vad", silence: 1 }, interimResults: true })).resolves.toMatchObject({
            heard: expect.stringContaining("book a table"),
        });
    });

    // Flux is a different endpoint with its own turn lifecycle, so it is worth
    // its own trip rather than trusting the nova-3 result to cover it.
    it("hears a turn end on flux", async () => {
        await expect(
            listen({ model: "flux-general-en", turnDetection: { mode: "vad", threshold: 0.7 } }),
        ).resolves.toMatchObject({ heard: expect.stringContaining("book a table") });
    });
});

/** Speaks a sentence, then feeds that audio back in as if it were a microphone. */
async function listen(input: Parameters<Voice<DeepgramProvider>["openSTTSession"]>[0]) {
    const spoken = await voice().speak({
        text: SPOKEN,
        format: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
    });

    const session = await voice().openSTTSession({
        ...input,
        inputFormat: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
    });

    const events: STTEvent[] = [];
    const reading = (async () => {
        for await (const event of session.output) {
            events.push(event);
            if (event.type === "transcript" && event.finality === "turn_end") return event.text;
        }
        return "";
    })();

    // 16 kHz s16le is 32000 bytes/sec, so 3200 bytes is 100ms; send it in real
    // time, then trail silence so the endpointer has something to detect.
    const frame = 3200;
    for (let at = 0; at < spoken.audio.length; at += frame) {
        session.push(spoken.audio.subarray(at, at + frame));
        await sleep(100);
    }
    for (let i = 0; i < 20; i += 1) {
        session.push(new Uint8Array(frame));
        await sleep(100);
    }

    const heard = await Promise.race([reading, sleep(8000).then(() => "")]);
    await session.close();

    return { heard: heard.toLowerCase(), events };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
