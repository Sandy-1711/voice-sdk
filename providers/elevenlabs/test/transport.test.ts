import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler, HttpMiddleware } from "@swungstudent/voice";
import { fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

const AUDIO = pcmRamp(16);
const VOICE = "voice-1";

let server: FakeHttp;

function provider(config = {}) {
    return new ElevenLabsProvider({ apiKey: "k", defaultVoice: VOICE, baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({
        [`POST /v1/text-to-speech/${VOICE}`]: { body: AUDIO },
        "POST /v1/speech-to-text": { body: { text: "hi", words: [] } },
    });
});

afterEach(async () => {
    await server.close();
});

/**
 * The generated client used to bridge camelCase and snake_case in both
 * directions. Nothing else does now, so these pin that it still happens.
 */
describe("case bridging", () => {
    it("sends the mapped body in snake_case", async () => {
        await provider().speak({ text: "hi", language: "es", controls: { similarity: 0.8 } });

        expect(server.last().json()).toMatchObject({
            model_id: "eleven_multilingual_v2",
            language_code: "es",
            voice_settings: { similarity_boost: 0.8 },
        });
    });

    it("converts a camelCase providerOption, which is how the SDK documented them", async () => {
        await provider().speak({ text: "hi", providerOptions: { previousText: "before" } });

        expect(server.last().json()).toMatchObject({ previous_text: "before" });
    });

    it("leaves a providerOption already written in snake_case alone", async () => {
        await provider().speak({ text: "hi", providerOptions: { previous_text: "before" } });

        expect(server.last().json()).toMatchObject({ previous_text: "before" });
    });

    it("reads a snake_case response back into core's shape", async () => {
        await server.close();
        server = await fakeHttp({
            "POST /v1/speech-to-text": {
                body: {
                    text: "hello",
                    language_code: "en",
                    language_probability: 0.9,
                    audio_duration_secs: 2,
                    transcription_id: "t-1",
                    words: [
                        {
                            text: "hello",
                            start: 0,
                            end: 1,
                            type: "word",
                            logprob: 0,
                            speaker_id: "speaker_0",
                        },
                    ],
                },
            },
        });

        const result = await provider().transcribe({ audio: new Uint8Array([1]) });

        expect(result).toMatchObject({
            language: "en",
            languageConfidence: 0.9,
            duration: 2,
            requestId: "t-1",
        });
        expect(result.words?.[0]).toMatchObject({ speaker: "speaker_0" });
    });

    // `labels` keys are the caller's own, not part of the schema — camelising
    // them would silently rename a voice's metadata.
    it("does not rename the keys inside a voice's labels", async () => {
        await server.close();
        server = await fakeHttp({
            "GET /v1/voices": {
                body: { voices: [{ voice_id: "v1", name: "Rachel", labels: { use_case: "narration" } }] },
            },
        });

        const voices = await provider().listVoices();

        expect(voices[0]).toMatchObject({ id: "v1", labels: { use_case: "narration" } });
    });
});

describe("speech-to-text upload", () => {
    it("posts multipart with the field names the API expects", async () => {
        await provider().transcribe({
            audio: new Uint8Array([1, 2]),
            model: "scribe_v1",
            language: "es",
            timestamps: "word",
            diarize: true,
            speakerCount: 2,
            keyterms: ["voice", "sdk"],
        });

        const body = server.last().text();
        expect(server.last().headers["content-type"]).toContain("multipart/form-data");
        for (const field of [
            'name="file"',
            'name="model_id"',
            'name="language_code"',
            'name="timestamps_granularity"',
            'name="diarize"',
            'name="num_speakers"',
            'name="keyterms"',
        ]) {
            expect(body).toContain(field);
        }
    });

    it("sends a url as source_url rather than downloading it", async () => {
        await provider().transcribe({ audio: { url: "https://audio.test/clip.wav" } });

        expect(server.last().text()).toContain('name="source_url"');
    });
});

describe("transport wiring", () => {
    it("runs caller middleware and names the operation", async () => {
        const seen: string[] = [];
        const trace: HttpMiddleware = (next) => (request) => {
            seen.push(`${request.meta.provider}.${request.meta.operation}`);
            return next(request);
        };

        await provider({ middleware: [trace] }).speak({ text: "hi" });

        expect(seen).toEqual(["elevenlabs.speak"]);
    });

    it("keeps the api key out of the log, since it rides in a header", async () => {
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

        await provider({ logger: log, apiKey: "super-secret" }).speak({ text: "hi" });

        const lines = [...log.debug.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
            .flat()
            .join("\n");
        expect(lines).toContain("elevenlabs.speak");
        expect(lines).not.toContain("super-secret");
    });

    it("retries a retryable status, which the SDK also did", async () => {
        await server.close();
        server = await fakeHttp({
            [`POST /v1/text-to-speech/${VOICE}`]: [{ status: 503, body: "unavailable" }, { body: AUDIO }],
        });

        await provider({ retries: 1 }).speak({ text: "hi" });

        expect(server.requests).toHaveLength(2);
    });

    it("retries a thrown network error, which the SDK never did", async () => {
        let call = 0;
        const flaky: HttpHandler = async () => {
            call += 1;
            if (call === 1) throw new Error("ECONNRESET");
            return new Response(AUDIO as unknown as BodyInit, { status: 200 });
        };

        const result = await provider({ retries: 1, fetch: flaky }).speak({ text: "hi" });

        expect(call).toBe(2);
        expect(result.audio).toEqual(AUDIO);
    });

    it("unwraps the detail out of a failure", async () => {
        await server.close();
        server = await fakeHttp({
            [`POST /v1/text-to-speech/${VOICE}`]: {
                status: 422,
                body: { detail: { status: "invalid_uid", message: "voice does not exist" } },
            },
        });

        await expect(provider({ retries: 0 }).speak({ text: "hi" })).rejects.toThrow(
            "ElevenLabs request failed (422): invalid_uid: voice does not exist",
        );
    });

    it("falls back to the raw body when a failure is not JSON", async () => {
        await server.close();
        server = await fakeHttp({
            [`POST /v1/text-to-speech/${VOICE}`]: { status: 502, body: "<html>gateway</html>" },
        });

        await expect(provider({ retries: 0 }).speak({ text: "hi" })).rejects.toThrow(
            "ElevenLabs request failed (502): <html>gateway</html>",
        );
    });
});
