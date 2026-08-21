import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeHttp, pcmRamp, wav, type FakeHttp } from "@voice-sdk/test-kit";
import { DeepgramProvider } from "../src/index";

/** A trimmed but shaped-like-the-wire response from `/v1/listen`. */
const RESPONSE = {
    metadata: { request_id: "req-7", duration: 3.25 },
    results: {
        channels: [
            {
                detected_language: "en",
                alternatives: [
                    {
                        transcript: "hello there",
                        confidence: 0.99,
                        languages: ["en"],
                        words: [
                            {
                                word: "hello",
                                start: 0.1,
                                end: 0.4,
                                confidence: 0.98,
                                punctuated_word: "Hello",
                                speaker: 0,
                            },
                            {
                                word: "there",
                                start: 0.4,
                                end: 0.8,
                                confidence: 0.97,
                                punctuated_word: "there.",
                                speaker: 0,
                            },
                        ],
                    },
                ],
            },
        ],
        utterances: [{ transcript: "hello there", start: 0.1, end: 0.8, confidence: 0.98, speaker: 0 }],
    },
};

let server: FakeHttp;

function provider(config = {}) {
    return new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({ "POST /v1/listen": { body: RESPONSE } });
});

afterEach(async () => {
    await server.close();
});

describe("transcribe", () => {
    it("posts audio as bytes and normalizes the response", async () => {
        const audio = wav(pcmRamp(64));

        const result = await provider().transcribe({ audio });

        expect(server.last().path).toBe("/v1/listen");
        expect(server.last().headers["content-type"]).toBe("application/octet-stream");
        expect(server.last().body).toEqual(audio);

        expect(result.text).toBe("hello there");
        expect(result.language).toBe("en");
        expect(result.duration).toBe(3.25);
        expect(result.confidence).toBe(0.99);
        expect(result.requestId).toBe("req-7");
        expect(result.raw).toEqual(RESPONSE);
    });

    // Deepgram fetches a URL itself, so pulling the bytes down first would be
    // a round trip spent for nothing.
    it("forwards a url source rather than downloading it", async () => {
        await provider().transcribe({ audio: { url: "https://audio.test/clip.wav" } });

        expect(server.last().headers["content-type"]).toBe("application/json");
        expect(server.last().json()).toEqual({ url: "https://audio.test/clip.wav" });
    });

    it("reads a stream source into a body", async () => {
        const audio = pcmRamp(8);
        async function* chunks() {
            yield audio.subarray(0, 8);
            yield audio.subarray(8);
        }

        await provider().transcribe({
            audio: chunks(),
            format: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
        });

        expect(server.last().body).toEqual(audio);
    });

    describe("query mapping", () => {
        it("sends the default model when none is named", async () => {
            await provider().transcribe({ audio: new Uint8Array([1]) });

            expect(server.last().query.model).toBe("nova-3");
        });

        it("carries language, diarize and keyterms", async () => {
            await provider().transcribe({
                audio: new Uint8Array([1]),
                model: "nova-2",
                language: "es",
                diarize: true,
                keyterms: ["voice", "sdk"],
            });

            expect(server.last().query).toMatchObject({ model: "nova-2", language: "es", diarize: "true" });
            expect(server.last().query.keyterm).toEqual(["voice", "sdk"]);
        });

        // Utterances are the only thing core's `segments` can be built from,
        // and Deepgram groups words into them only when asked.
        it("asks for utterances when the caller wants segments", async () => {
            await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "segment" });
            expect(server.last().query.utterances).toBe("true");

            await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "word" });
            expect(server.last().query.utterances).toBeUndefined();
        });

        it("names the codec for headerless audio and stays quiet for framed audio", async () => {
            await provider().transcribe({
                audio: new Uint8Array([1]),
                format: { container: "raw", encoding: "pcm_s16le", sampleRate: 16000 },
            });
            expect(server.last().query).toMatchObject({ encoding: "linear16", sample_rate: "16000" });

            await provider().transcribe({ audio: wav(pcmRamp(4)), format: { container: "wav" } });
            expect(server.last().query.encoding).toBeUndefined();
        });

        it("lets providerOptions through for settings core does not model", async () => {
            await provider().transcribe({
                audio: new Uint8Array([1]),
                providerOptions: { smart_format: true },
            });

            expect(server.last().query.smart_format).toBe("true");
        });
    });

    describe("result mapping", () => {
        it("maps words, keeping speaker zero and the punctuated form", async () => {
            const result = await provider().transcribe({ audio: new Uint8Array([1]) });

            expect(result.words).toEqual([
                { text: "hello", start: 0.1, end: 0.4, confidence: 0.98, punctuated: "Hello", speaker: "0" },
                { text: "there", start: 0.4, end: 0.8, confidence: 0.97, punctuated: "there.", speaker: "0" },
            ]);
        });

        it("maps utterances onto segments", async () => {
            const result = await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "segment" });

            expect(result.segments).toEqual([
                { text: "hello there", start: 0.1, end: 0.8, confidence: 0.98, speaker: "0" },
            ]);
        });

        // Deepgram always times its words, so the flag only decides whether to
        // hand them back.
        it("drops the words when the caller asked for no timestamps", async () => {
            const result = await provider().transcribe({ audio: new Uint8Array([1]), timestamps: false });

            expect(result.words).toBeUndefined();
        });

        it("falls back through detected_language, languages, then what the caller said", async () => {
            await server.close();
            server = await fakeHttp({
                "POST /v1/listen": {
                    body: {
                        results: {
                            channels: [{ alternatives: [{ transcript: "hola", languages: ["es"] }] }],
                        },
                    },
                },
            });
            expect((await provider().transcribe({ audio: new Uint8Array([1]) })).language).toBe("es");

            await server.close();
            server = await fakeHttp({
                "POST /v1/listen": {
                    body: { results: { channels: [{ alternatives: [{ transcript: "hola" }] }] } },
                },
            });
            expect(
                (await provider().transcribe({ audio: new Uint8Array([1]), language: "fr" })).language,
            ).toBe("fr");
        });

        it("survives a response with no results at all", async () => {
            await server.close();
            server = await fakeHttp({ "POST /v1/listen": { body: {} } });

            const result = await provider().transcribe({ audio: new Uint8Array([1]) });

            expect(result.text).toBe("");
            expect(result.words).toBeUndefined();
            expect(result.segments).toBeUndefined();
        });
    });

    it("refuses character timestamps, which Deepgram does not report", async () => {
        await expect(
            provider().transcribe({ audio: new Uint8Array([1]), timestamps: "character" }),
        ).rejects.toMatchObject({ name: "ValidationError", field: "timestamps" });

        expect(server.requests).toHaveLength(0);
    });
});
