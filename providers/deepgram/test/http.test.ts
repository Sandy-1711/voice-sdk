import { afterEach, describe, expect, it } from "vitest";
import { VoiceError } from "@voice-sdk/core";
import { fakeHttp, type FakeHttp } from "@voice-sdk/test-kit";
import { DEFAULT_BASE_URL } from "../src/config";
import { buildUrl, send } from "../src/internal/http";

let server: FakeHttp | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

describe("buildUrl", () => {
    it("falls back to the public host", () => {
        expect(buildUrl(undefined, "/v1/speak", {}).toString()).toBe(`${DEFAULT_BASE_URL}/v1/speak`);
    });

    it("honours a self-hosted or regional base", () => {
        expect(buildUrl("https://self-hosted.test", "/v1/listen", {}).toString()).toBe(
            "https://self-hosted.test/v1/listen",
        );
    });

    // Deepgram configures everything through the query string, so this is the
    // one place that decides how a mapped value reaches the wire.
    it("stringifies scalars", () => {
        const url = buildUrl(undefined, "/v1/listen", { model: "nova-3", diarize: true, sample_rate: 16000 });

        expect(url.searchParams.get("model")).toBe("nova-3");
        expect(url.searchParams.get("diarize")).toBe("true");
        expect(url.searchParams.get("sample_rate")).toBe("16000");
    });

    it("drops undefined rather than sending the string undefined", () => {
        const url = buildUrl(undefined, "/v1/listen", { language: undefined, model: "nova-3" });

        expect(url.searchParams.has("language")).toBe(false);
        expect(url.search).toBe("?model=nova-3");
    });

    it("repeats the key for an array, which is how Deepgram takes keyterms", () => {
        const url = buildUrl(undefined, "/v1/listen", { keyterm: ["voice", "sdk"] });

        expect(url.searchParams.getAll("keyterm")).toEqual(["voice", "sdk"]);
    });

    it("sends an empty array as no parameter at all", () => {
        expect(buildUrl(undefined, "/v1/listen", { keyterm: [] }).search).toBe("");
    });
});

describe("send", () => {
    it("posts with the token scheme Deepgram expects", async () => {
        server = await fakeHttp({ "POST /v1/speak": { body: new Uint8Array([1, 2, 3]) } });

        const response = await send({
            apiKey: "secret-key",
            url: buildUrl(server.baseUrl, "/v1/speak", { model: "aura-2-thalia-en" }),
            body: JSON.stringify({ text: "hi" }),
            contentType: "application/json",
        });

        expect(response.status).toBe(200);
        expect(server.last().method).toBe("POST");
        expect(server.last().headers.authorization).toBe("Token secret-key");
        expect(server.last().headers["content-type"]).toBe("application/json");
        expect(server.last().json()).toEqual({ text: "hi" });
        expect(server.last().query.model).toBe("aura-2-thalia-en");
    });

    it("sends raw bytes when the body is audio", async () => {
        server = await fakeHttp({ "POST /v1/listen": { body: { results: {} } } });
        const audio = new Uint8Array([9, 8, 7, 6]);

        await send({
            apiKey: "k",
            url: buildUrl(server.baseUrl, "/v1/listen", {}),
            body: audio,
            contentType: "application/octet-stream",
        });

        expect(server.last().body).toEqual(audio);
    });

    describe("retries", () => {
        it("retries a 429 and returns the attempt that succeeds", async () => {
            server = await fakeHttp({
                "POST /v1/speak": [{ status: 429, body: "slow down" }, { body: new Uint8Array([1]) }],
            });

            const response = await send({
                apiKey: "k",
                url: buildUrl(server.baseUrl, "/v1/speak", {}),
                body: "{}",
                contentType: "application/json",
                context: { retries: 1 },
            });

            expect(response.ok).toBe(true);
            expect(server.requests).toHaveLength(2);
        });

        it("retries a 5xx", async () => {
            server = await fakeHttp({
                "POST /v1/speak": [{ status: 503, body: "unavailable" }, { body: new Uint8Array([1]) }],
            });

            await send({
                apiKey: "k",
                url: buildUrl(server.baseUrl, "/v1/speak", {}),
                body: "{}",
                contentType: "application/json",
                context: { retries: 1 },
            });

            expect(server.requests).toHaveLength(2);
        });

        // A second attempt cannot fix a bad parameter, so it is not worth the latency.
        it("does not retry a 4xx", async () => {
            server = await fakeHttp({
                "POST /v1/speak": { status: 400, body: { err_code: "INVALID_MODEL", err_msg: "no such model" } },
            });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { retries: 2 },
                }),
            ).rejects.toBeInstanceOf(VoiceError);

            expect(server.requests).toHaveLength(1);
        });

        it("gives up after the last attempt and reports the final failure", async () => {
            server = await fakeHttp({ "POST /v1/speak": { status: 500, body: { err_msg: "still broken" } } });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { retries: 1 },
                }),
            ).rejects.toThrow(/still broken/);

            expect(server.requests).toHaveLength(2);
        });

        it("can be switched off", async () => {
            server = await fakeHttp({ "POST /v1/speak": { status: 500, body: "boom" } });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { retries: 0 },
                }),
            ).rejects.toBeInstanceOf(VoiceError);

            expect(server.requests).toHaveLength(1);
        });
    });

    describe("failures", () => {
        // A bare "400 Bad Request" hides which parameter Deepgram rejected.
        it("unwraps err_code and err_msg into the message", async () => {
            server = await fakeHttp({
                "POST /v1/speak": { status: 400, body: { err_code: "INVALID_MODEL", err_msg: "no such model" } },
            });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { retries: 0 },
                }),
            ).rejects.toThrow("Deepgram request failed (400): INVALID_MODEL: no such model");
        });

        it("falls back to the raw body when the failure is not JSON", async () => {
            server = await fakeHttp({ "POST /v1/speak": { status: 502, body: "<html>gateway</html>" } });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { retries: 0 },
                }),
            ).rejects.toThrow("Deepgram request failed (502): <html>gateway</html>");
        });
    });

    describe("deadlines", () => {
        it("aborts a request that outruns the timeout", async () => {
            server = await fakeHttp({
                "POST /v1/speak": async () => {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    return { body: new Uint8Array([1]) };
                },
            });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { timeout: 50, retries: 0 },
                }),
            ).rejects.toThrow(/timed out/);
        });

        // The caller's abort is the answer, not a failure worth retrying.
        it("stops immediately when the caller aborts, without retrying", async () => {
            server = await fakeHttp({
                "POST /v1/speak": async () => {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    return { status: 500, body: "boom" };
                },
            });
            const controller = new AbortController();
            setTimeout(() => controller.abort(new Error("caller changed their mind")), 50);

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { signal: controller.signal, retries: 3 },
                }),
            ).rejects.toThrow("caller changed their mind");

            expect(server.requests).toHaveLength(1);
        });

        it("refuses a signal that was already aborted", async () => {
            server = await fakeHttp({ "POST /v1/speak": { body: new Uint8Array([1]) } });

            await expect(
                send({
                    apiKey: "k",
                    url: buildUrl(server.baseUrl, "/v1/speak", {}),
                    body: "{}",
                    contentType: "application/json",
                    context: { signal: AbortSignal.abort(new Error("already gone")), timeout: 1000, retries: 0 },
                }),
            ).rejects.toThrow("already gone");
        });
    });
});
