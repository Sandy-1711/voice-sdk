import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler, HttpMiddleware } from "@swungstudent/voice";
import { fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

const AUDIO = pcmRamp(16);
const VOICE = "voice-1";

let server: FakeHttp;

function provider(config = {}) {
    return new CartesiaProvider({ apiKey: "k", defaultVoice: VOICE, baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeHttp({
        "POST /tts/bytes": { body: AUDIO },
        "POST /stt": { body: { text: "hi" } },
    });
});

afterEach(async () => {
    await server.close();
});

/**
 * Cartesia used to inherit retry and deadlines from its SDK. These pin what
 * core's transport does in its place — none of which the SDK's own retry did
 * for thrown network errors.
 */
describe("auth", () => {
    it("sends the bearer token and pins the schema version", async () => {
        await provider({ apiKey: "secret-key" }).speak({ text: "hi" });

        expect(server.last().headers["authorization"]).toBe("Bearer secret-key");
        expect(server.last().headers["cartesia-version"]).toBe("2025-11-04");
    });

    it("authenticates the multipart upload the same way", async () => {
        await provider({ apiKey: "secret-key" }).transcribe({ audio: new Uint8Array([1]) });

        expect(server.last().headers["authorization"]).toBe("Bearer secret-key");
        expect(server.last().headers["cartesia-version"]).toBe("2025-11-04");
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

        expect(seen).toEqual(["cartesia.speak"]);
    });

    it("names speakStream separately, so a stream is legible in a log", async () => {
        await server.close();
        server = await fakeHttp({ "POST /tts/sse": { chunks: ['data: {"type":"done"}\n\n'] } });

        const seen: string[] = [];
        const trace: HttpMiddleware = (next) => (request) => {
            seen.push(request.meta.operation);
            return next(request);
        };

        for await (const _ of provider({ middleware: [trace] }).speakStream({ text: "hi" })) void _;

        expect(seen).toEqual(["speakStream"]);
    });

    it("keeps the api key out of the log, since it rides in a header", async () => {
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

        await provider({ logger: log, apiKey: "super-secret" }).speak({ text: "hi" });

        const lines = [...log.debug.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
            .flat()
            .join("\n");
        expect(lines).toContain("cartesia.speak");
        expect(lines).not.toContain("super-secret");
    });

    it("retries a retryable status, which the SDK also did", async () => {
        await server.close();
        server = await fakeHttp({
            "POST /tts/bytes": [{ status: 503, body: "unavailable" }, { body: AUDIO }],
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

    it("honours a per-call abort signal", async () => {
        await expect(
            provider().speak({ text: "hi" }, { signal: AbortSignal.abort() }),
        ).rejects.toThrowError();
    });
});

/**
 * Cartesia had no HTTP error normaliser at all before: a failure arrived as
 * whichever error class the SDK happened to construct.
 */
describe("failures", () => {
    async function failWith(body: string | object, status = 400): Promise<string> {
        await server.close();
        server = await fakeHttp({ "POST /tts/bytes": { status, body } });

        try {
            await provider({ retries: 0 }).speak({ text: "hi" });
        } catch (error) {
            return (error as Error).message;
        }
        throw new Error("Expected speak to reject, but it resolved.");
    }

    it("unwraps the title and message pair", async () => {
        expect(await failWith({ title: "Bad voice", message: "no such voice id" }, 422)).toBe(
            "Cartesia request failed (422): Bad voice: no such voice id",
        );
    });

    it("unwraps a bare message", async () => {
        expect(await failWith({ message: "transcript is required" })).toBe(
            "Cartesia request failed (400): transcript is required",
        );
    });

    it("unwraps the error field the API uses", async () => {
        expect(await failWith({ error: "invalid api key" }, 401)).toBe(
            "Cartesia request failed (401): invalid api key",
        );
    });

    it("falls back to the raw body when a failure is not JSON", async () => {
        expect(await failWith("<html>gateway</html>", 502)).toBe(
            "Cartesia request failed (502): <html>gateway</html>",
        );
    });

    it("falls back to the raw body when the JSON has no field it knows", async () => {
        expect(await failWith({ unexpected: true })).toBe(
            'Cartesia request failed (400): {"unexpected":true}',
        );
    });
});
