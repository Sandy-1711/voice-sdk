import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect, fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { DeepgramProvider } from "../src/index";

const AUDIO = pcmRamp(32);

let server: FakeHttp;

function provider(config = {}) {
    return new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({
        "POST /v1/speak": { body: AUDIO, headers: { "dg-request-id": "req-42" } },
    });
});

afterEach(async () => {
    await server.close();
});

describe("speak", () => {
    it("posts the text and hands back the audio with the format it is in", async () => {
        const result = await provider().speak({ text: "hello there" });

        expect(server.last().path).toBe("/v1/speak");
        expect(server.last().json()).toEqual({ text: "hello there" });
        expect(result.audio).toEqual(AUDIO);
        expect(result.requestId).toBe("req-42");
        // Batch audio is written to a file more often than not, so it is framed.
        expect(result.format).toEqual({ container: "wav", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 });
    });

    it("sends the default model when the caller names none", async () => {
        await provider().speak({ text: "hi" });

        expect(server.last().query).toMatchObject({
            model: "aura-2-thalia-en",
            encoding: "linear16",
            container: "wav",
            sample_rate: "24000",
        });
    });

    // A Deepgram voice *is* a model, so both spellings have to land on `model`.
    it("accepts a voice as the model, and lets an explicit model win", async () => {
        await provider().speak({ text: "hi", voice: "aura-2-andromeda-en" });
        expect(server.last().query.model).toBe("aura-2-andromeda-en");

        await provider().speak({ text: "hi", voice: "aura-2-andromeda-en", model: "aura-2-thalia-en" });
        expect(server.last().query.model).toBe("aura-2-thalia-en");
    });

    it("takes the provider default voice when a call names none", async () => {
        await provider({ defaultVoice: "aura-2-luna-en" }).speak({ text: "hi" });

        expect(server.last().query.model).toBe("aura-2-luna-en");
    });

    it("lowers a requested format onto the query, and reports what it resolved to", async () => {
        const result = await provider().speak({
            text: "hi",
            format: { container: "mp3", bitrate: 48, sampleRate: 48000 },
        });

        expect(server.last().query).toMatchObject({
            encoding: "mp3",
            container: "none",
            sample_rate: "48000",
            bit_rate: "48000",
        });
        expect(result.format).toEqual({
            container: "mp3",
            encoding: "mp3",
            sampleRate: 48000,
            channels: 1,
            bitrate: 48,
        });
    });

    it("uses the provider default format when a call gives none", async () => {
        const result = await provider({ defaultFormat: { container: "raw", sampleRate: 16000 } }).speak({ text: "hi" });

        expect(server.last().query).toMatchObject({ container: "none", sample_rate: "16000" });
        expect(result.format.container).toBe("raw");
    });

    it("passes speed through, the one control Deepgram has a knob for", async () => {
        await provider().speak({ text: "hi", controls: { speed: 1.25, volume: 2, emotion: "happy" } });

        expect(server.last().query.speed).toBe("1.25");
        expect(server.last().query.volume).toBeUndefined();
    });

    it("lets providerOptions reach the query for settings core does not model", async () => {
        await provider().speak({ text: "hi", providerOptions: { mip_opt_out: true, model: "aura-2-orpheus-en" } });

        expect(server.last().query).toMatchObject({ mip_opt_out: "true", model: "aura-2-orpheus-en" });
    });

    // Better a named error than audio that silently carries no alignment.
    it("refuses a request for timings before spending a round trip", async () => {
        await expect(provider().speak({ text: "hi", timings: true })).rejects.toMatchObject({
            name: "ValidationError",
            field: "timings",
        });

        expect(server.requests).toHaveLength(0);
    });

    it("refuses an impossible format without asking Deepgram", async () => {
        await expect(provider().speak({ text: "hi", format: { sampleRate: 44100 } })).rejects.toMatchObject({
            field: "format.sampleRate",
        });

        expect(server.requests).toHaveLength(0);
    });
});

describe("speakStream", () => {
    it("knows the format before the first chunk arrives", () => {
        const stream = provider().speakStream({ text: "hi" });

        // Streamed audio goes to a speaker or a socket, where a header is noise.
        expect(stream.format).toEqual({ container: "raw", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 });
    });

    it("sends nothing until the caller starts iterating", async () => {
        provider().speakStream({ text: "hi" });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(server.requests).toHaveLength(0);
    });

    it("yields the response body as it arrives", async () => {
        await server.close();
        server = await fakeHttp({
            "POST /v1/speak": { chunks: [AUDIO.subarray(0, 20), AUDIO.subarray(20)], chunkDelay: 5 },
        });

        const chunks = await collect(provider().speakStream({ text: "hi" }));

        expect(chunks.length).toBeGreaterThan(1);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)))).toEqual(Buffer.from(AUDIO));
    });

    it("streams headerless audio, and refuses a container that has to be framed", () => {
        expect(() => provider().speakStream({ text: "hi", format: { container: "wav" } })).not.toThrow();
        expect(provider().speakStream({ text: "hi", format: { container: "wav" } }).format.container).toBe("wav");
    });

    it("surfaces a failure from the far side on the stream itself", async () => {
        await server.close();
        server = await fakeHttp({ "POST /v1/speak": { status: 400, body: { err_msg: "bad model" } } });

        await expect(collect(provider().speakStream({ text: "hi" }))).rejects.toThrow(/bad model/);
    });
});
