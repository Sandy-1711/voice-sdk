import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@voice-sdk/core";
import { collect, fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

const AUDIO = pcmRamp(32);
const VOICE = "voice-1";

let server: FakeHttp;

function provider(config = {}) {
    return new ElevenLabsProvider({ apiKey: "k", defaultVoice: VOICE, baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({
        [`POST /v1/text-to-speech/${VOICE}`]: { body: AUDIO },
        [`POST /v1/text-to-speech/${VOICE}/stream`]: { chunks: [AUDIO.subarray(0, 20), AUDIO.subarray(20)] },
        [`POST /v1/text-to-speech/${VOICE}/with-timestamps`]: {
            body: {
                audio_base64: encodeBase64(AUDIO),
                alignment: {
                    characters: ["h", "i"],
                    character_start_times_seconds: [0, 0.1],
                    character_end_times_seconds: [0.1, 0.2],
                },
            },
        },
    });
});

afterEach(async () => {
    await server.close();
});

describe("speak", () => {
    it("posts to the voice's endpoint and returns the audio", async () => {
        const result = await provider().speak({ text: "hello there" });

        expect(server.last().path).toBe(`/v1/text-to-speech/${VOICE}`);
        expect(server.last().headers["xi-api-key"]).toBe("k");
        expect(server.last().json()).toMatchObject({ text: "hello there", model_id: "eleven_multilingual_v2" });
        expect(result.audio).toEqual(AUDIO);
    });

    it("reports the format it resolved to, so the caller can play the bytes", async () => {
        const result = await provider().speak({ text: "hi" });

        expect(result.format).toEqual({
            container: "mp3",
            encoding: "mp3",
            sampleRate: 44100,
            bitrate: 128,
            channels: 1,
        });
        expect(server.last().query.output_format).toBe("mp3_44100_128");
    });

    it("puts the requested voice in the path, overriding the provider default", async () => {
        await server.close();
        server = await fakeHttp({ "POST /v1/text-to-speech/voice-2": { body: AUDIO } });

        await provider().speak({ text: "hi", voice: "voice-2" });

        expect(server.last().path).toBe("/v1/text-to-speech/voice-2");
    });

    it("carries the model, language and voice settings", async () => {
        await provider().speak({
            text: "hola",
            model: "eleven_flash_v2_5",
            language: "es",
            controls: { speed: 1.1, similarity: 0.8 },
        });

        expect(server.last().json()).toMatchObject({
            model_id: "eleven_flash_v2_5",
            language_code: "es",
            voice_settings: { speed: 1.1, similarity_boost: 0.8 },
        });
    });

    it("lets providerOptions reach the body", async () => {
        await provider().speak({ text: "hi", providerOptions: { seed: 42 } });

        expect(server.last().json()).toMatchObject({ seed: 42 });
    });

    // convertWithTimestamps returns JSON carrying base64 audio, where convert
    // returns an audio stream - so each needs its own handling.
    it("switches to the timestamped endpoint when timings are asked for", async () => {
        const result = await provider().speak({ text: "hi", timings: true });

        expect(server.last().path).toBe(`/v1/text-to-speech/${VOICE}/with-timestamps`);
        expect(result.audio).toEqual(AUDIO);
        expect(result.alignment).toEqual({
            unit: "character",
            spans: [
                { text: "h", start: 0, end: 0.1 },
                { text: "i", start: 0.1, end: 0.2 },
            ],
        });
    });

    it("refuses a voice it does not have, naming both ways to supply one", async () => {
        const bare = new ElevenLabsProvider({ apiKey: "k", baseUrl: server.baseUrl });

        await expect(bare.speak({ text: "hi" })).rejects.toMatchObject({ name: "ValidationError", field: "voice" });
        expect(server.requests).toHaveLength(0);
    });

    it("refuses word timings before spending a round trip", async () => {
        await expect(provider().speak({ text: "hi", timings: "word" })).rejects.toMatchObject({ field: "timings" });

        expect(server.requests).toHaveLength(0);
    });
});

describe("speakStream", () => {
    it("knows the format before the first chunk arrives", () => {
        expect(provider().speakStream({ text: "hi" }).format).toMatchObject({ container: "mp3", sampleRate: 44100 });
    });

    it("sends nothing until the caller starts iterating", async () => {
        provider().speakStream({ text: "hi" });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(server.requests).toHaveLength(0);
    });

    it("streams the response from the streaming endpoint", async () => {
        const chunks = await collect(provider().speakStream({ text: "hi" }));

        expect(server.last().path).toBe(`/v1/text-to-speech/${VOICE}/stream`);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)))).toEqual(Buffer.from(AUDIO));
    });

    // A wav header declares a length that is not known until generation ends.
    it("refuses wav, which cannot be streamed", () => {
        expect(() => provider().speakStream({ text: "hi", format: { container: "wav", sampleRate: 16000 } })).toThrowError(
            expect.objectContaining({ field: "format.container" }),
        );
    });

    it("stamps each chunk with its offset when timings are asked for", async () => {
        await server.close();
        server = await fakeHttp({
            [`POST /v1/text-to-speech/${VOICE}/stream/with-timestamps`]: {
                chunks: [
                    `${JSON.stringify({
                        audio_base64: encodeBase64(AUDIO.subarray(0, 20)),
                        alignment: {
                            characters: ["h"],
                            character_start_times_seconds: [0],
                            character_end_times_seconds: [0.1],
                        },
                    })}\n`,
                    `${JSON.stringify({
                        audio_base64: encodeBase64(AUDIO.subarray(20)),
                        alignment: {
                            characters: ["i"],
                            character_start_times_seconds: [0.1],
                            character_end_times_seconds: [0.2],
                        },
                    })}\n`,
                ],
                headers: { "content-type": "application/json" },
            },
        });

        const chunks = await collect(provider().speakStream({ text: "hi", timings: "character" }));

        expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 0.1]);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)))).toEqual(Buffer.from(AUDIO));
    });
});
