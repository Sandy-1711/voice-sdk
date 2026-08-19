import { describe, expect, it, vi } from "vitest";
import {
    compose,
    createTransport,
    logging,
    rateLimit,
    redact,
    retry,
    timeout,
} from "../src/index";
import type { HttpHandler, HttpRequest, RequestMeta } from "../src/index";

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
    const meta: RequestMeta = { provider: "fake", operation: "speak", attempt: 0, ...overrides.meta };
    return { url: new URL("https://api.test/v1/speak"), method: "POST", headers: {}, ...overrides, meta };
}

/** Replays a scripted list of statuses, recording what each attempt was handed. */
function scripted(...replies: (number | Error)[]): { handler: HttpHandler; seen: RequestMeta[] } {
    const seen: RequestMeta[] = [];
    let call = 0;

    const handler: HttpHandler = async (incoming) => {
        seen.push(incoming.meta);
        const reply = replies[Math.min(call, replies.length - 1)];
        call += 1;
        if (reply instanceof Error) throw reply;
        return new Response("body", { status: reply });
    };

    return { handler, seen };
}

/** Never answers on its own; only an abort ends it. */
const hangs: HttpHandler = (incoming) =>
    new Promise((_resolve, reject) => {
        incoming.signal?.addEventListener("abort", () => reject(incoming.signal?.reason), { once: true });
    });

const fast = { baseDelay: 1, maxDelay: 2 };

describe("compose", () => {
    it("puts the first middleware outermost", async () => {
        const order: string[] = [];
        const tag = (name: string) => (next: HttpHandler): HttpHandler => async (incoming) => {
            order.push(`${name} in`);
            const response = await next(incoming);
            order.push(`${name} out`);
            return response;
        };

        await compose([tag("a"), tag("b")])(async () => new Response())(request());

        expect(order).toEqual(["a in", "b in", "b out", "a out"]);
    });
});

describe("retry", () => {
    it.each([408, 429, 500, 503])("retries %i and returns the eventual success", async (status) => {
        const { handler, seen } = scripted(status, 200);
        const response = await retry(fast)(handler)(request());

        expect(response.status).toBe(200);
        expect(seen).toHaveLength(2);
    });

    it("does not retry a status the server means", async () => {
        const { handler, seen } = scripted(400, 200);
        const response = await retry(fast)(handler)(request());

        expect(response.status).toBe(400);
        expect(seen).toHaveLength(1);
    });

    it("returns the last failure rather than throwing it", async () => {
        const { handler, seen } = scripted(500);
        const response = await retry({ ...fast, retries: 2 })(handler)(request());

        // Only the provider knows how to read its own error envelope.
        expect(response.status).toBe(500);
        expect(seen).toHaveLength(3);
    });

    it("stamps the attempt number on each try", async () => {
        const { handler, seen } = scripted(500, 500, 200);
        await retry(fast)(handler)(request());

        expect(seen.map((meta) => meta.attempt)).toEqual([0, 1, 2]);
    });

    it("retries a thrown network error, which the generated SDKs never did", async () => {
        const { handler, seen } = scripted(new Error("ECONNRESET"), 200);
        const response = await retry(fast)(handler)(request());

        expect(response.status).toBe(200);
        expect(seen).toHaveLength(2);
    });

    it("gives up on a thrown error once the attempts run out", async () => {
        const { handler } = scripted(new Error("ECONNRESET"));

        await expect(retry({ ...fast, retries: 1 })(handler)(request())).rejects.toThrow("ECONNRESET");
    });

    it("lets a per-call retries override beat the configured default", async () => {
        const { handler, seen } = scripted(500);
        await retry({ ...fast, retries: 5 })(handler)(request({ meta: { retries: 0 } as RequestMeta }));

        expect(seen).toHaveLength(1);
    });

    it("treats the caller's abort as an answer, not a failure", async () => {
        const controller = new AbortController();
        const handler: HttpHandler = async () => {
            controller.abort(new Error("caller left"));
            throw new Error("aborted");
        };
        const seen = vi.fn(handler);

        await expect(retry(fast)(seen)(request({ signal: controller.signal }))).rejects.toThrow();
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it("will not replay a stream body, which the first attempt consumed", async () => {
        const { handler, seen } = scripted(500, 200);
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1]));
                controller.close();
            },
        });

        await retry(fast)(handler)(request({ body }));

        expect(seen).toHaveLength(1);
    });

    it("waits as long as Retry-After asks", async () => {
        let call = 0;
        const handler: HttpHandler = async () => {
            call += 1;
            return call === 1
                ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } })
                : new Response("ok", { status: 200 });
        };

        const started = Date.now();
        const response = await retry({ baseDelay: 1, maxDelay: 5000 })(handler)(request());

        expect(response.status).toBe(200);
        // The header asked for a second; the 1ms backoff would not have waited.
        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    });

    it("caps a Retry-After that asks for longer than maxDelay", async () => {
        let call = 0;
        const handler: HttpHandler = async () => {
            call += 1;
            return call === 1
                ? new Response("slow down", { status: 429, headers: { "retry-after": "600" } })
                : new Response("ok", { status: 200 });
        };

        const started = Date.now();
        await retry({ baseDelay: 1, maxDelay: 20 })(handler)(request());

        expect(Date.now() - started).toBeLessThan(500);
    });

    it("releases the socket of a response it is about to discard", async () => {
        const cancel = vi.fn(async () => {});
        let call = 0;
        const handler: HttpHandler = async () => {
            call += 1;
            if (call > 1) return new Response("ok", { status: 200 });
            const response = new Response("nope", { status: 500 });
            Object.defineProperty(response, "body", { value: { cancel } });
            return response;
        };

        await retry(fast)(handler)(request());

        expect(cancel).toHaveBeenCalled();
    });
});

describe("timeout", () => {
    it("passes through untouched when no deadline is set", async () => {
        let seen: HttpRequest | undefined;
        const handler: HttpHandler = async (incoming) => {
            seen = incoming;
            return new Response("ok");
        };

        await timeout()(handler)(request());

        expect(seen?.signal).toBeUndefined();
    });

    it("aborts a request whose headers never arrive", async () => {
        await expect(timeout({ ms: 20 })(hangs)(request())).rejects.toThrow(/timed out after 20ms/);
    });

    it("lets a per-call timeout beat the configured default", async () => {
        await expect(
            timeout({ ms: 10_000 })(hangs)(request({ meta: { timeout: 20 } as RequestMeta })),
        ).rejects.toThrow(/timed out after 20ms/);
    });

    it("forwards the caller's abort while it is still waiting", async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("caller left")), 10);

        await expect(
            timeout({ ms: 10_000 })(hangs)(request({ signal: controller.signal })),
        ).rejects.toThrow("caller left");
    });

    it("stops holding the deadline once the headers land", async () => {
        const handler: HttpHandler = async () => new Response("ok");
        const response = await timeout({ ms: 20 })(handler)(request());

        // A body that outlives the deadline is a slow download, not a failure.
        await new Promise((resolve) => setTimeout(resolve, 40));
        await expect(response.text()).resolves.toBe("ok");
    });

    it("keeps a streaming response cancellable by the caller's signal", async () => {
        const controller = new AbortController();
        let aborted = false;
        const handler: HttpHandler = async (incoming) => {
            incoming.signal?.addEventListener("abort", () => {
                aborted = true;
            });
            return new Response("ok");
        };

        await timeout({ ms: 10_000 })(handler)(request({ signal: controller.signal, meta: { stream: true } as RequestMeta }));
        controller.abort(new Error("barge-in"));

        expect(aborted).toBe(true);
    });
});

describe("rateLimit", () => {
    it("holds requests above the concurrency cap", async () => {
        let active = 0;
        let peak = 0;
        const handler: HttpHandler = async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active -= 1;
            return new Response("ok");
        };

        const limited = rateLimit({ concurrency: 2 })(handler);
        await Promise.all([1, 2, 3, 4, 5].map(() => limited(request())));

        expect(peak).toBe(2);
    });

    it("spaces starts by minInterval", async () => {
        const starts: number[] = [];
        const handler: HttpHandler = async () => {
            starts.push(Date.now());
            return new Response("ok");
        };

        const limited = rateLimit({ minInterval: 25 })(handler);
        await Promise.all([1, 2, 3].map(() => limited(request())));

        expect(starts).toHaveLength(3);
        expect((starts.at(-1) as number) - (starts[0] as number)).toBeGreaterThanOrEqual(40);
    });

    it("gives the slot back when a request fails", async () => {
        const handler: HttpHandler = async () => {
            throw new Error("boom");
        };
        const limited = rateLimit({ concurrency: 1 })(handler);

        await expect(limited(request())).rejects.toThrow("boom");
        // A leaked slot would leave this one queued forever.
        await expect(limited(request())).rejects.toThrow("boom");
    });
});

describe("logging", () => {
    function logger() {
        return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    }

    it("reports a success at debug", async () => {
        const log = logger();
        await logging({ logger: log })(async () => new Response("ok"))(request());

        expect(log.debug.mock.calls[0]?.[0]).toMatch(/fake\.speak ← 200 in \d+ms/);
    });

    it("warns on a failing status and names the target", async () => {
        const log = logger();
        await logging({ logger: log })(async () => new Response("no", { status: 401 }))(request());

        expect(log.warn.mock.calls[0]?.[0]).toContain("401");
        expect(log.warn.mock.calls[0]?.[0]).toContain("/v1/speak");
    });

    it("reports a thrown error and rethrows it", async () => {
        const log = logger();
        const failing = logging({ logger: log })(async () => {
            throw new Error("ECONNRESET");
        });

        await expect(failing(request())).rejects.toThrow("ECONNRESET");
        expect(log.error.mock.calls[0]?.[0]).toContain("ECONNRESET");
    });

    it("keeps credentials out of the log", () => {
        const url = new URL("https://api.test/v1/speak?model=x&api_key=sk-secret&token=t&sig=s");

        expect(redact(url)).toContain("model=x");
        expect(redact(url)).not.toContain("sk-secret");
        expect(redact(url)).not.toContain("token=t");
        expect(redact(url)).not.toContain("sig=s");
    });
});

describe("createTransport", () => {
    it("retries through the assembled chain and logs the outcome once", async () => {
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const { handler, seen } = scripted(500, 200);

        const transport = createTransport({
            provider: "fake",
            retries: 1,
            logger: log,
            rateLimit: { concurrency: 1 },
            fetch: handler,
        });
        const response = await transport(request());

        expect(response.status).toBe(200);
        expect(seen).toHaveLength(2);
        // One outcome line for the whole logical request, not one per attempt.
        expect(log.debug.mock.calls.filter(([line]) => String(line).includes("←"))).toHaveLength(1);
    });

    it("applies caller middleware outside the built-ins", async () => {
        const order: string[] = [];
        const transport = createTransport({
            provider: "fake",
            middleware: [
                (next) => async (incoming) => {
                    order.push("caller");
                    return next(incoming);
                },
            ],
            fetch: async () => {
                order.push("fetch");
                return new Response("ok");
            },
        });

        await transport(request());

        expect(order).toEqual(["caller", "fetch"]);
    });

    it("carries a per-call timeout into the chain", async () => {
        const transport = createTransport({ provider: "fake", fetch: hangs });

        await expect(transport(request({ meta: { timeout: 20 } as RequestMeta }))).rejects.toThrow(/timed out/);
    });
});
