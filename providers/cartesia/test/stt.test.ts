import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeHttp, pcmRamp, wav, type FakeHttp } from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

const RESPONSE = {
    text: "hello there",
    language: "en",
    duration: 3.25,
    request_id: "req-7",
    words: [
        { word: "hello", start: 0.1, end: 0.4 },
        { word: "there", start: 0.4, end: 0.8 },
    ],
};

let server: FakeHttp;

function provider(config = {}) {
    return new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({ "POST /stt": { body: RESPONSE } });
});

afterEach(async () => {
    await server.close();
});

describe("transcribe", () => {
    it("uploads the audio and normalizes the response", async () => {
        const result = await provider().transcribe({ audio: wav(pcmRamp(64)) });

        expect(server.last().path).toBe("/stt");
        expect(server.last().headers["content-type"]).toContain("multipart/form-data");

        expect(result.text).toBe("hello there");
        expect(result.language).toBe("en");
        expect(result.duration).toBe(3.25);
        expect(result.requestId).toBe("req-7");
        expect(result.raw).toMatchObject({ text: "hello there" });
    });

    it("sends the default model when none is named", async () => {
        await provider().transcribe({ audio: new Uint8Array([1]) });

        expect(server.last().text()).toContain("ink-whisper");
    });

    // The client splits these: the model and language ride in the multipart
    // body, while the input format goes on the query string.
    it("carries the model, language and encoding", async () => {
        await provider().transcribe({
            audio: new Uint8Array([1]),
            model: "ink-2",
            language: "es",
            format: { encoding: "mulaw", sampleRate: 8000 },
        });

        const body = server.last().text();
        expect(body).toContain("ink-2");
        expect(body).toContain("es");
        expect(server.last().query).toMatchObject({ encoding: "pcm_mulaw", sample_rate: "8000" });
    });

    // Word is the only granularity Cartesia offers.
    it("asks for word timestamps whenever any were requested", async () => {
        await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "word" });
        expect(server.last().text()).toContain("word");

        await provider().transcribe({ audio: new Uint8Array([1]), timestamps: false });
        expect(server.last().text()).not.toContain("timestamp_granularities");
    });

    it("collects a stream source before uploading it", async () => {
        const audio = pcmRamp(8);
        async function* chunks() {
            yield audio.subarray(0, 8);
            yield audio.subarray(8);
        }

        await provider().transcribe({ audio: chunks() });

        expect(server.last().body.byteLength).toBeGreaterThan(audio.byteLength);
    });

    it("maps the words onto core's shape", async () => {
        const result = await provider().transcribe({ audio: new Uint8Array([1]), timestamps: "word" });

        expect(result.words).toEqual([
            { text: "hello", start: 0.1, end: 0.4 },
            { text: "there", start: 0.4, end: 0.8 },
        ]);
    });

    it("reports no words when Cartesia sent none", async () => {
        await server.close();
        server = await fakeHttp({ "POST /stt": { body: { ...RESPONSE, words: undefined } } });

        expect((await provider().transcribe({ audio: new Uint8Array([1]) })).words).toBeUndefined();
    });

    it("refuses an encoding with no equivalent, before uploading", async () => {
        await expect(
            provider().transcribe({ audio: new Uint8Array([1]), format: { encoding: "mp3" } }),
        ).rejects.toMatchObject({ name: "ValidationError", field: "format.encoding" });

        expect(server.requests).toHaveLength(0);
    });

    it("lets providerOptions reach the request", async () => {
        await provider().transcribe({ audio: new Uint8Array([1]), providerOptions: { model: "ink-2" } });

        expect(server.last().text()).toContain("ink-2");
    });
});
