import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A request the fake server received, kept for assertions. */
export interface RecordedRequest {
    method: string;
    /** Path without the query string. */
    path: string;
    url: URL;
    /** Repeated keys collapse into an array, as they do on the wire. */
    query: Record<string, string | string[]>;
    headers: Record<string, string>;
    body: Uint8Array;
    text(): string;
    json<T = unknown>(): T;
}

export interface ScriptedReply {
    status?: number;
    headers?: Record<string, string>;
    /** A plain object is sent as JSON; a string or bytes are sent verbatim. */
    body?: string | Uint8Array | object;
    /** Written one at a time, so the client reads a chunked response. */
    chunks?: (string | Uint8Array)[];
    /** Milliseconds between chunks. */
    chunkDelay?: number;
}

export type RouteHandler = (request: RecordedRequest, call: number) => ScriptedReply | Promise<ScriptedReply>;

/**
 * One reply, a handler, or a list of replies played in order — the list is what
 * makes retry paths testable (429, then 200).
 */
export type Route = ScriptedReply | ScriptedReply[] | RouteHandler;

/** Routes are keyed `"POST /v1/speak"`. `"*"` catches anything unmatched. */
export type Routes = Record<string, Route>;

export interface FakeHttp {
    /** Pass this as the provider's `baseUrl`. */
    baseUrl: string;
    requests: RecordedRequest[];
    /** The most recent request, or the nth from the end. */
    last(back?: number): RecordedRequest;
    close(): Promise<void>;
}

/**
 * A real HTTP server on an ephemeral port, so provider code exercises its own
 * URL building, headers and streaming rather than a stubbed `fetch`.
 */
export async function fakeHttp(routes: Routes = {}): Promise<FakeHttp> {
    const requests: RecordedRequest[] = [];
    const calls = new Map<string, number>();

    const server: Server = createServer((incoming, response) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
            void (async () => {
                const request = record(incoming.method ?? "GET", incoming.url ?? "/", incoming.headers, Buffer.concat(chunks));
                requests.push(request);

                const key = `${request.method} ${request.path}`;
                const route = routes[key] ?? routes["*"];
                if (!route) {
                    response.writeHead(404, { "content-type": "application/json" });
                    response.end(JSON.stringify({ error: `No route for "${key}". Known routes: ${Object.keys(routes).join(", ") || "(none)"}` }));
                    return;
                }

                const call = calls.get(key) ?? 0;
                calls.set(key, call + 1);

                let reply: ScriptedReply;
                if (typeof route === "function") reply = await route(request, call);
                else if (Array.isArray(route)) reply = route[Math.min(call, route.length - 1)] ?? {};
                else reply = route;

                const headers = { ...reply.headers };
                const hasType = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");

                if (reply.chunks) {
                    if (!hasType) headers["content-type"] = "application/octet-stream";
                    response.writeHead(reply.status ?? 200, headers);
                    for (const chunk of reply.chunks) {
                        response.write(Buffer.from(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
                        if (reply.chunkDelay) await sleep(reply.chunkDelay);
                    }
                    response.end();
                    return;
                }

                const body = reply.body;
                let payload: Buffer;
                if (body === undefined) {
                    payload = Buffer.alloc(0);
                } else if (typeof body === "string") {
                    payload = Buffer.from(body);
                    if (!hasType) headers["content-type"] = "text/plain";
                } else if (body instanceof Uint8Array) {
                    payload = Buffer.from(body);
                    if (!hasType) headers["content-type"] = "application/octet-stream";
                } else {
                    payload = Buffer.from(JSON.stringify(body));
                    if (!hasType) headers["content-type"] = "application/json";
                }

                response.writeHead(reply.status ?? 200, headers);
                response.end(payload);
            })();
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        last(back = 0) {
            const request = requests[requests.length - 1 - back];
            if (!request) throw new Error(`No request recorded ${back} back; the server saw ${requests.length}.`);
            return request;
        },
        close() {
            return new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

function record(
    method: string,
    target: string,
    headers: NodeJS.Dict<string | string[]>,
    body: Buffer,
): RecordedRequest {
    const url = new URL(target, "http://127.0.0.1");
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length > 1 ? values : (values[0] as string);
    }

    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(", ") : value;
    }

    return {
        method,
        path: url.pathname,
        url,
        query,
        headers: flat,
        body: new Uint8Array(body),
        text: () => body.toString("utf8"),
        json: <T,>() => JSON.parse(body.toString("utf8")) as T,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
