import { afterEach, describe, expect, it } from "vitest";
import { fakeHttp, type FakeHttp, type Routes } from "../src/index";

let server: FakeHttp;

async function serve(routes: Routes = {}) {
    server = await fakeHttp(routes);
    return server;
}

afterEach(async () => {
    await server.close();
});

describe("routing", () => {
    it("matches on method and path together", async () => {
        await serve({
            "GET /v1/voices": { body: { voices: [] } },
            "POST /v1/voices": { body: { created: true } },
        });

        expect(await (await fetch(`${server.baseUrl}/v1/voices`)).json()).toEqual({ voices: [] });
        expect(await (await fetch(`${server.baseUrl}/v1/voices`, { method: "POST" })).json()).toEqual({
            created: true,
        });
    });

    it("ignores the query string when matching", async () => {
        await serve({ "GET /v1/speak": { body: "ok" } });

        const response = await fetch(`${server.baseUrl}/v1/speak?model=sonic&voice=v1`);

        expect(response.status).toBe(200);
    });

    it("falls back to the wildcard route", async () => {
        await serve({ "*": { status: 418, body: "anything" } });

        const response = await fetch(`${server.baseUrl}/whatever/path`, { method: "DELETE" });

        expect(response.status).toBe(418);
        expect(await response.text()).toBe("anything");
    });

    it("prefers an exact route over the wildcard", async () => {
        await serve({ "GET /exact": { body: "exact" }, "*": { body: "wildcard" } });

        expect(await (await fetch(`${server.baseUrl}/exact`)).text()).toBe("exact");
        expect(await (await fetch(`${server.baseUrl}/other`)).text()).toBe("wildcard");
    });

    // The 404 body is the error a test sees when it typos a route, so it has to
    // say what was actually registered.
    it("answers an unmatched request by listing the known routes", async () => {
        await serve({ "GET /v1/speak": { body: "" }, "POST /v1/listen": { body: "" } });

        const response = await fetch(`${server.baseUrl}/v1/nope`);

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: 'No route for "GET /v1/nope". Known routes: GET /v1/speak, POST /v1/listen',
        });
    });

    it("says so when there are no routes at all", async () => {
        await serve();

        const { error } = (await (await fetch(server.baseUrl)).json()) as { error: string };

        expect(error).toContain("Known routes: (none)");
    });
});

describe("scripted replies", () => {
    // The list form is what makes a retry path testable: fail, then succeed.
    it("plays a list of replies in order", async () => {
        await serve({
            "GET /flaky": [
                { status: 429, body: "slow down" },
                { status: 200, body: "ok" },
            ],
        });

        expect((await fetch(`${server.baseUrl}/flaky`)).status).toBe(429);
        expect((await fetch(`${server.baseUrl}/flaky`)).status).toBe(200);
    });

    // Without the clamp a third call would fall off the end of the list and the
    // retry test would get an empty reply instead of the success it scripted.
    it("holds the last reply once the list runs out", async () => {
        await serve({ "GET /flaky": [{ status: 429 }, { status: 200, body: "ok" }] });

        await fetch(`${server.baseUrl}/flaky`);
        await fetch(`${server.baseUrl}/flaky`);

        const third = await fetch(`${server.baseUrl}/flaky`);
        expect(third.status).toBe(200);
        expect(await third.text()).toBe("ok");
    });

    it("counts calls per route, not across them", async () => {
        await serve({
            "GET /a": [{ body: "a1" }, { body: "a2" }],
            "GET /b": [{ body: "b1" }, { body: "b2" }],
        });

        await fetch(`${server.baseUrl}/a`);

        expect(await (await fetch(`${server.baseUrl}/b`)).text()).toBe("b1");
    });

    it("hands a handler the request and the call index", async () => {
        const seen: number[] = [];
        await serve({
            "POST /echo": (request, call) => {
                seen.push(call);
                return { body: { echoed: request.json() } };
            },
        });

        await fetch(`${server.baseUrl}/echo`, { method: "POST", body: JSON.stringify({ n: 1 }) });
        const second = await fetch(`${server.baseUrl}/echo`, {
            method: "POST",
            body: JSON.stringify({ n: 2 }),
        });

        expect(seen).toEqual([0, 1]);
        expect(await second.json()).toEqual({ echoed: { n: 2 } });
    });

    it("awaits an async handler", async () => {
        await serve({
            "GET /slow": async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { body: "eventually" };
            },
        });

        expect(await (await fetch(`${server.baseUrl}/slow`)).text()).toBe("eventually");
    });

    it("sends an empty body when the reply has none", async () => {
        await serve({ "GET /empty": { status: 204 } });

        const response = await fetch(`${server.baseUrl}/empty`);

        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
    });
});

describe("content types", () => {
    it("sends an object as JSON", async () => {
        await serve({ "GET /json": { body: { ok: true } } });

        const response = await fetch(`${server.baseUrl}/json`);

        expect(response.headers.get("content-type")).toBe("application/json");
        expect(await response.json()).toEqual({ ok: true });
    });

    it("sends a string as text", async () => {
        await serve({ "GET /text": { body: "hello" } });

        expect((await fetch(`${server.baseUrl}/text`)).headers.get("content-type")).toBe("text/plain");
    });

    it("sends bytes as an octet stream", async () => {
        await serve({ "GET /bytes": { body: new Uint8Array([1, 2, 3]) } });

        const response = await fetch(`${server.baseUrl}/bytes`);

        expect(response.headers.get("content-type")).toBe("application/octet-stream");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    // Providers sniff the header to decide how to read a body, so a test has to
    // be able to say "audio/wav" over the default - whatever case it uses.
    it("lets an explicit content-type win, whatever its casing", async () => {
        await serve({
            "GET /wav": { headers: { "Content-Type": "audio/wav" }, body: new Uint8Array([1]) },
        });

        expect((await fetch(`${server.baseUrl}/wav`)).headers.get("content-type")).toBe("audio/wav");
    });

    it("passes other headers through", async () => {
        await serve({ "GET /id": { headers: { "x-request-id": "req-7" }, body: "" } });

        expect((await fetch(`${server.baseUrl}/id`)).headers.get("x-request-id")).toBe("req-7");
    });
});

describe("chunked replies", () => {
    it("writes each chunk separately so the client reads a stream", async () => {
        await serve({ "GET /stream": { chunks: ["one", "two", "three"] } });

        const response = await fetch(`${server.baseUrl}/stream`);
        const reader = response.body!.getReader();
        const chunks: string[] = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(new TextDecoder().decode(value));
        }

        expect(chunks.join("")).toBe("onetwothree");
        expect(response.headers.get("content-type")).toBe("application/octet-stream");
    });

    it("takes binary chunks too", async () => {
        await serve({ "GET /audio": { chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] } });

        const response = await fetch(`${server.baseUrl}/audio`);

        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("spaces chunks out by chunkDelay", async () => {
        await serve({ "GET /paced": { chunks: ["a", "b", "c"], chunkDelay: 20 } });

        const started = Date.now();
        await (await fetch(`${server.baseUrl}/paced`)).text();

        expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    });

    it("still lets an explicit content-type win", async () => {
        await serve({
            "GET /sse": { headers: { "content-type": "text/event-stream" }, chunks: ["data: 1\n\n"] },
        });

        expect((await fetch(`${server.baseUrl}/sse`)).headers.get("content-type")).toBe("text/event-stream");
    });
});

describe("recorded requests", () => {
    it("records the method, path and body of every request", async () => {
        await serve({ "*": { body: "" } });

        await fetch(`${server.baseUrl}/v1/speak`, { method: "POST", body: "hello" });

        expect(server.requests).toHaveLength(1);
        expect(server.last()).toMatchObject({ method: "POST", path: "/v1/speak" });
        expect(server.last().text()).toBe("hello");
        expect(server.last().body).toEqual(new Uint8Array(Buffer.from("hello")));
    });

    it("parses a JSON body on demand", async () => {
        await serve({ "*": { body: "" } });

        await fetch(server.baseUrl, { method: "POST", body: JSON.stringify({ text: "hi" }) });

        expect(server.last().json()).toEqual({ text: "hi" });
    });

    it("keeps the path and the query separate", async () => {
        await serve({ "*": { body: "" } });

        await fetch(`${server.baseUrl}/v1/listen?model=nova-3`);

        expect(server.last().path).toBe("/v1/listen");
        expect(server.last().url.searchParams.get("model")).toBe("nova-3");
    });

    // Repeated keys are how a provider sends a list, so collapsing them to the
    // last value would hide a mapping bug.
    it("collapses a repeated query key into an array", async () => {
        await serve({ "*": { body: "" } });

        await fetch(`${server.baseUrl}/v1/listen?keyterm=voice&keyterm=sdk&model=nova-3`);

        expect(server.last().query).toEqual({ keyterm: ["voice", "sdk"], model: "nova-3" });
    });

    it("lowercases header names, as the wire does", async () => {
        await serve({ "*": { body: "" } });

        await fetch(server.baseUrl, { headers: { Authorization: "Bearer secret" } });

        expect(server.last().headers["authorization"]).toBe("Bearer secret");
    });

    it("reaches back through the history with last(n)", async () => {
        await serve({ "*": { body: "" } });

        await fetch(`${server.baseUrl}/first`);
        await fetch(`${server.baseUrl}/second`);

        expect(server.last().path).toBe("/second");
        expect(server.last(1).path).toBe("/first");
    });

    it("throws with the count when there is no such request", async () => {
        await serve({ "*": { body: "" } });

        expect(() => server.last()).toThrow(/No request recorded 0 back; the server saw 0\./);

        await fetch(server.baseUrl);
        expect(() => server.last(3)).toThrow(/the server saw 1\./);
    });
});
