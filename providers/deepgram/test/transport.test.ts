import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler, HttpMiddleware } from "@swungstudent/voice";
import { fakeHttp, type FakeHttp } from "@voice-sdk/test-kit";
import { DeepgramProvider } from "../src/index";

let server: FakeHttp | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

const AUDIO = new Uint8Array([1, 2, 3]);

function logger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("transport wiring", () => {
    it("runs caller middleware on every request", async () => {
        server = await fakeHttp({ "POST /v1/speak": { body: AUDIO } });
        const seen: string[] = [];
        const trace: HttpMiddleware = (next) => (request) => {
            seen.push(`${request.meta.provider}.${request.meta.operation}`);
            return next(request);
        };

        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, middleware: [trace] });
        await provider.speak({ text: "hi" });

        expect(seen).toEqual(["deepgram.speak"]);
    });

    it("names the operation behind each request, not just the path", async () => {
        server = await fakeHttp({
            "POST /v1/speak": { body: AUDIO },
            "POST /v1/listen": { body: { results: {} } },
        });
        const seen: string[] = [];
        const trace: HttpMiddleware = (next) => (request) => {
            seen.push(request.meta.operation);
            return next(request);
        };

        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, middleware: [trace] });
        await provider.speak({ text: "hi" });
        await provider.transcribe({ audio: AUDIO });
        for await (const _chunk of provider.speakStream({ text: "hi" })) break;

        expect(seen).toEqual(["speak", "transcribe", "speakStream"]);
    });

    it("logs a request when a logger is configured", async () => {
        server = await fakeHttp({ "POST /v1/speak": { body: AUDIO } });
        const log = logger();

        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, logger: log });
        await provider.speak({ text: "hi" });

        expect(log.debug.mock.calls.some(([line]) => String(line).includes("deepgram.speak ← 200"))).toBe(
            true,
        );
    });

    it("keeps the api key out of the log, since it rides in a header", async () => {
        server = await fakeHttp({ "POST /v1/speak": { body: AUDIO } });
        const log = logger();

        const provider = new DeepgramProvider({
            apiKey: "super-secret",
            baseUrl: server.baseUrl,
            logger: log,
        });
        await provider.speak({ text: "hi" });

        const lines = [...log.debug.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
            .flat()
            .join("\n");
        expect(lines).not.toContain("super-secret");
    });

    it("holds requests above the configured concurrency", async () => {
        let active = 0;
        let peak = 0;
        server = await fakeHttp({
            "POST /v1/speak": async () => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 20));
                active -= 1;
                return { body: AUDIO };
            },
        });

        const provider = new DeepgramProvider({
            apiKey: "k",
            baseUrl: server.baseUrl,
            rateLimit: { concurrency: 2 },
        });
        await Promise.all([1, 2, 3, 4].map(() => provider.speak({ text: "hi" })));

        expect(peak).toBe(2);
    });

    it("takes a provider-level retry count", async () => {
        server = await fakeHttp({
            "POST /v1/speak": [{ status: 503, body: "unavailable" }, { body: AUDIO }],
        });

        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, retries: 1 });
        await provider.speak({ text: "hi" });

        expect(server.requests).toHaveLength(2);
    });

    it("lets a per-call context override the provider-level retry count", async () => {
        server = await fakeHttp({ "POST /v1/speak": { status: 503, body: "unavailable" } });

        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, retries: 4 });
        await expect(provider.speak({ text: "hi" }, { retries: 0 })).rejects.toThrow(/503/);

        expect(server.requests).toHaveLength(1);
    });

    it("retries a thrown network error, which the old hand-rolled client also did", async () => {
        let call = 0;
        const flaky: HttpHandler = async () => {
            call += 1;
            if (call === 1) throw new Error("ECONNRESET");
            return new Response(AUDIO, { status: 200 });
        };

        const provider = new DeepgramProvider({ apiKey: "k", retries: 1, fetch: flaky });
        const result = await provider.speak({ text: "hi" });

        expect(call).toBe(2);
        expect(result.audio).toEqual(AUDIO);
    });

    it("waits as long as Retry-After asks, which the old client ignored", async () => {
        server = await fakeHttp({
            "POST /v1/speak": [
                { status: 429, body: "slow down", headers: { "retry-after": "1" } },
                { body: AUDIO },
            ],
        });

        const started = Date.now();
        const provider = new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, retries: 1 });
        await provider.speak({ text: "hi" });

        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    });
});
