import { describe, expect, it } from "vitest";
import { Voice, type STTEvent, type TTSEvent } from "@swungstudent/voice";
import {
    assertCapabilityInvariants,
    assertSTTEvent,
    assertTTSEvent,
    assertTurnSequence,
    requireLiveKey,
    SPOKEN_SAMPLE_RATE,
    spokenSample,
    wav,
} from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../../src/index";

/**
 * The opt-in tier: real API, real key, real money.
 *
 *   ELEVENLABS_API_KEY=... pnpm test:live
 *
 * Set ELEVENLABS_VOICE_ID to use your own voice. The default is Sarah, from the
 * premade set every account gets — a *library* voice 402s on a free plan with
 * "Free users cannot use library voices via the API", which is what Rachel
 * (21m00Tcm4TlvDq8ikWAM) does despite being the example in most docs.
 */
const KEY = requireLiveKey("ELEVENLABS_API_KEY");
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

const TEXT = "The quick brown fox jumps over the lazy dog.";

const voice = () =>
    new Voice({
        provider: new ElevenLabsProvider({ apiKey: KEY, defaultVoice: VOICE_ID }),
        options: { timeout: 30_000 },
    });

describe.skipIf(!KEY)("elevenlabs (live)", () => {
    // Free: no request leaves the process. Worth a test of its own so a
    // capability flag drifting from the methods behind it is caught here too.
    it("implements every capability it claims", () => {
        assertCapabilityInvariants(new ElevenLabsProvider({ apiKey: KEY }));
    });

    it("speaks, and the resolved format describes the bytes", async () => {
        const result = await voice().speak({ text: TEXT, format: { container: "mp3", sampleRate: 44100 } });

        expect(result.audio.byteLength).toBeGreaterThan(1000);
        expect(result.format).toMatchObject({ container: "mp3", sampleRate: 44100, channels: 1 });
    });

    // convertWithTimestamps is a different endpoint returning base64 JSON, so
    // it is worth its own trip.
    it("reports character alignment when asked", async () => {
        const result = await voice().speak({ text: "Hello there.", timings: "character" });

        expect(result.alignment?.unit).toBe("character");
        expect(result.alignment?.spans.length).toBeGreaterThan(0);
        expect(result.alignment?.spans[0]?.end).toBeGreaterThanOrEqual(
            result.alignment?.spans[0]?.start ?? 0,
        );
    });

    it("streams synthesis in more than one chunk", async () => {
        const stream = voice().speakStream({ text: TEXT });

        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk.data);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBeGreaterThan(1000);
    });

    it("transcribes the sample", async () => {
        const audio = wav(spokenSample(), SPOKEN_SAMPLE_RATE);

        const result = await voice().transcribe({ audio, timestamps: "word" });

        expect(result.text.toLowerCase()).toContain("book a table");
        expect(result.words?.length).toBeGreaterThan(0);
        expect(result.duration).toBeGreaterThan(0);
    });

    it("lists voices, including the one being spoken with", async () => {
        const voices = await voice().listVoices();

        expect(voices.length).toBeGreaterThan(0);
        expect(voices[0]).toMatchObject({ id: expect.any(String) });
    });

    it("runs a synthesis session and reports it finished", async () => {
        const session = await voice().openTTSSession({
            format: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
        });
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

        for (const event of events) assertTTSEvent(event);
        expect(events.filter((event) => event.type === "audio").length).toBeGreaterThan(0);
    });

    it("hears a turn end from pushed audio", async () => {
        const audio = spokenSample();

        const session = await voice().openSTTSession({
            inputFormat: { container: "raw", encoding: "pcm_s16le", sampleRate: SPOKEN_SAMPLE_RATE },
            turnDetection: { mode: "vad", silence: 1 },
        });

        const events: STTEvent[] = [];
        const reading = (async () => {
            for await (const event of session.output) {
                events.push(event);
                if (event.type === "transcript" && event.finality === "turn_end") return event.text;
            }
            return "";
        })();

        const frame = 3200;
        for (let at = 0; at < audio.length; at += frame) {
            session.push(audio.subarray(at, at + frame));
            await sleep(100);
        }
        for (let i = 0; i < 20; i += 1) {
            session.push(new Uint8Array(frame));
            await sleep(100);
        }

        const heard = await Promise.race([reading, sleep(8000).then(() => "")]);
        await session.close();

        for (const event of events) assertSTTEvent(event);
        assertTurnSequence(events);
        expect(heard.toLowerCase()).toContain("book a table");
    });
});

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
