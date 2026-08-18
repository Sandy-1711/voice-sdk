import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@swungstudent/voice";
import { collect, fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

const AUDIO = pcmRamp(32);
const VOICE = "voice-1";

/** `/tts/sse` answers with server-sent events carrying base64 chunks. */
function sse(...events: object[]): string[] {
    return events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
}

let server: FakeHttp;

function provider(config = {}) {
    return new CartesiaProvider({ apiKey: "k", defaultVoice: VOICE, baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({
        "POST /tts/bytes": { body: AUDIO, headers: { "x-request-id": "req-5" } },
        "POST /tts/sse": {
            chunks: sse(
                { type: "chunk", data: encodeBase64(AUDIO.subarray(0, 20)), done: false },
                { type: "chunk", data: encodeBase64(AUDIO.subarray(20)), done: false },
                { type: "done", done: true },
            ),
            headers: { "content-type": "text/event-stream" },
        },
    });
});

afterEach(async () => {
    await server.close();
});

describe("speak", () => {
    it("posts the transcript and hands back the audio with the format it is in", async () => {
        const result = await provider().speak({ text: "hello there" });

        expect(server.last().path).toBe("/tts/bytes");
        expect(server.last().json()).toMatchObject({
            transcript: "hello there",
            model_id: "sonic-3.5",
            voice: { mode: "id", id: VOICE },
        });
        expect(result.audio).toEqual(AUDIO);
        expect(result.requestId).toBe("req-5");
        // Batch audio is usually written to a file, so it carries a header.
        expect(result.format).toEqual({ container: "wav", encoding: "pcm_s16le", sampleRate: 44100, channels: 1 });
    });

    it("sends the output format Cartesia spells out as an object", async () => {
        const result = await provider().speak({ text: "hi", format: { container: "raw", sampleRate: 24000 } });

        expect(server.last().json()).toMatchObject({
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
        });
        expect(result.format.container).toBe("raw");
    });

    it("carries the model, language and generation config", async () => {
        await provider().speak({
            text: "hola",
            model: "sonic-2",
            language: "es",
            voice: "voice-2",
            controls: { speed: 1.2, emotion: "curiosity" },
        });

        expect(server.last().json()).toMatchObject({
            model_id: "sonic-2",
            language: "es",
            voice: { mode: "id", id: "voice-2" },
            generation_config: { speed: 1.2, emotion: "curiosity" },
        });
    });

    it("lets providerOptions reach the body", async () => {
        await provider().speak({ text: "hi", providerOptions: { duration: 5 } });

        expect(server.last().json()).toMatchObject({ duration: 5 });
    });

    // `format` is the typed way to ask, so the mapped output_format is applied
    // after the merge and wins outright. Note this differs from the realtime
    // session, where output_format sits inside the merge and providerOptions
    // can tweak it.
    it("keeps the mapped output format over one passed through providerOptions", async () => {
        await provider().speak({
            text: "hi",
            format: { container: "raw", sampleRate: 44100 },
            providerOptions: { output_format: { sample_rate: 24000 } },
        });

        expect(server.last().json()).toMatchObject({
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
        });
    });

    it("refuses to guess a voice, naming both ways to supply one", async () => {
        const bare = new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl });

        await expect(bare.speak({ text: "hi" })).rejects.toMatchObject({ name: "ValidationError", field: "voice" });
        expect(server.requests).toHaveLength(0);
    });

    it("refuses an impossible format without asking Cartesia", async () => {
        await expect(provider().speak({ text: "hi", format: { sampleRate: 32000 } })).rejects.toMatchObject({
            field: "format.sampleRate",
        });

        expect(server.requests).toHaveLength(0);
    });
});

describe("speakStream", () => {
    it("knows the format before the first chunk arrives", () => {
        // Streamed audio goes to a speaker or a socket, where a header is noise.
        expect(provider().speakStream({ text: "hi" }).format).toEqual({
            container: "raw",
            encoding: "pcm_s16le",
            sampleRate: 44100,
            channels: 1,
        });
    });

    it("sends nothing until the caller starts iterating", async () => {
        provider().speakStream({ text: "hi" });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(server.requests).toHaveLength(0);
    });

    it("decodes the base64 chunks the sse endpoint sends", async () => {
        const chunks = await collect(provider().speakStream({ text: "hi" }));

        expect(server.last().path).toBe("/tts/sse");
        expect(chunks).toHaveLength(2);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)))).toEqual(Buffer.from(AUDIO));
    });

    it("asks for timestamps only when the caller wants them", async () => {
        await collect(provider().speakStream({ text: "hi", timings: true }));
        expect(server.last().json()).toMatchObject({ add_timestamps: true });

        await collect(provider().speakStream({ text: "hi" }));
        expect(server.last().json()).toMatchObject({ add_timestamps: false });
    });

    // The SSE endpoint only accepts raw output.
    it("refuses a framed container", () => {
        expect(() => provider().speakStream({ text: "hi", format: { container: "wav" } })).toThrowError(
            expect.objectContaining({ field: "format.container" }),
        );
    });
});
