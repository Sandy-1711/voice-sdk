import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoiceError } from "@swungstudent/voice";
import { fakeHttp, pcmRamp, wav, type FakeHttp } from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

/** Shaped like the wire, which is snake_case - the SDK camelizes it. */
const RESPONSE = {
    language_code: "en",
    language_probability: 0.98,
    text: "hello there",
    transcription_id: "trans-1",
    audio_duration_secs: 3.25,
    words: [
        { text: "hello", start: 0.1, end: 0.4, type: "word", logprob: 0, speaker_id: "speaker_0" },
        { text: " ", start: 0.4, end: 0.4, type: "spacing", logprob: 0 },
        { text: "there", start: 0.4, end: 0.8, type: "word", logprob: -0.1 },
    ],
};

let server: FakeHttp;

function provider(config = {}) {
    return new ElevenLabsProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({ "POST /v1/speech-to-text": { body: RESPONSE } });
});

afterEach(async () => {
    await server.close();
});

describe("transcribe", () => {
    it("uploads the audio and normalizes the response", async () => {
        const result = await provider().transcribe({ audio: wav(pcmRamp(64)) });

        expect(server.last().path).toBe("/v1/speech-to-text");
        expect(server.last().headers["xi-api-key"]).toBe("k");
        expect(server.last().headers["content-type"]).toContain("multipart/form-data");

        expect(result.text).toBe("hello there");
        expect(result.language).toBe("en");
        expect(result.languageConfidence).toBe(0.98);
        expect(result.duration).toBe(3.25);
        expect(result.requestId).toBe("trans-1");
        expect(result.raw).toMatchObject({ text: "hello there" });
    });

    // ElevenLabs takes a URL natively, so skip the round trip when given one.
    it("forwards a url rather than downloading it", async () => {
        await provider().transcribe({ audio: { url: "https://audio.test/clip.wav" } });

        expect(server.last().text()).toContain("https://audio.test/clip.wav");
    });

    it("sends the default model when none is named", async () => {
        await provider().transcribe({ audio: new Uint8Array([1]) });

        expect(server.last().text()).toContain("scribe_v2");
    });

    it("carries the transcription settings", async () => {
        await provider().transcribe({
            audio: new Uint8Array([1]),
            model: "scribe_v1",
            language: "es",
            timestamps: "word",
            diarize: true,
            speakerCount: 2,
            keyterms: ["voice"],
        });

        const body = server.last().text();
        expect(body).toContain("scribe_v1");
        expect(body).toContain("es");
        expect(body).toContain("word");
        expect(body).toContain("voice");
    });

    it("maps words, turning log probabilities into confidences", async () => {
        const result = await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "word" });

        expect(result.words?.[0]).toEqual({
            text: "hello",
            start: 0.1,
            end: 0.4,
            confidence: 1,
            speaker: "speaker_0",
            kind: "word",
        });
        expect(result.words?.[1]).toMatchObject({ kind: "spacing" });
        expect(result.words?.[2]?.confidence).toBeCloseTo(0.905, 3);
    });

    it("reports no words rather than an empty list", async () => {
        await server.close();
        server = await fakeHttp({ "POST /v1/speech-to-text": { body: { ...RESPONSE, words: [] } } });

        expect((await provider().transcribe({ audio: new Uint8Array([1]) })).words).toBeUndefined();
    });

    // A multichannel or webhook response has no core equivalent, and silently
    // returning an empty transcript would be worse than saying so.
    it("refuses a response shape core cannot represent", async () => {
        await server.close();
        server = await fakeHttp({
            "POST /v1/speech-to-text": {
                body: {
                    transcripts: [RESPONSE, { ...RESPONSE, text: "second channel" }],
                    transcription_id: "trans-2",
                    audio_duration_secs: 3.25,
                },
            },
        });

        const failure = await provider()
            .transcribe({ audio: new Uint8Array([1]), providerOptions: { useMultiChannel: true } })
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(VoiceError);
        expect((failure as Error).message).toContain("multichannel");
    });

    it("refuses a granularity ElevenLabs does not report, before uploading", async () => {
        await expect(
            provider().transcribe({ audio: new Uint8Array([1]), timestamps: "segment" }),
        ).rejects.toMatchObject({ name: "ValidationError", field: "timestamps" });

        expect(server.requests).toHaveLength(0);
    });

    it("refuses a headerless format it cannot name, before uploading", async () => {
        await expect(
            provider().transcribe({
                audio: new Uint8Array([1]),
                format: { container: "raw", encoding: "pcm_s16le", sampleRate: 8000 },
            }),
        ).rejects.toMatchObject({ name: "ValidationError", field: "format" });

        expect(server.requests).toHaveLength(0);
    });
});
