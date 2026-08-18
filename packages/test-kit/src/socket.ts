import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

/** Text frames arrive as strings, binary frames as bytes — as the wire has them. */
export type Frame = string | Uint8Array;

export interface FakeConnection {
    /** The URL the client handshook with, query string intact. */
    readonly url: URL;
    readonly headers: Record<string, string>;
    /** Every frame the client has sent so far. */
    readonly received: Frame[];
    /** Resolves with the next frame the test has not consumed yet. */
    next(timeout?: number): Promise<Frame>;
    /** `next()` parsed as JSON. */
    nextJson<T = unknown>(timeout?: number): Promise<T>;
    /** Waits for a frame matching `predicate`, consuming everything before it. */
    nextMatching<T = unknown>(predicate: (message: T) => boolean, timeout?: number): Promise<T>;
    /** Objects are sent as JSON, strings and bytes verbatim. */
    send(data: string | Uint8Array | object): void;
    close(code?: number, reason?: string): void;
    /** Every text frame parsed as JSON, for one-shot assertions at the end. */
    json<T = unknown>(): T[];
}

export interface FakeSocket {
    /** Pass as the provider's `baseUrl`; providers turn `http:` into `ws:`. */
    baseUrl: string;
    connections: FakeConnection[];
    /** Waits for the nth connection (0-based), since sockets may open lazily. */
    connection(index?: number, timeout?: number): Promise<FakeConnection>;
    close(): Promise<void>;
}

export interface FakeSocketOptions {
    /** Runs as soon as a client connects, for scripting server-first protocols. */
    onConnect?: (connection: FakeConnection, index: number) => void;
}

/**
 * A real WebSocket server on an ephemeral port. Provider sessions build their
 * own URLs and handshake headers, so faking at this level keeps that code honest.
 */
export async function fakeSocket(options: FakeSocketOptions = {}): Promise<FakeSocket> {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const connections: FakeConnection[] = [];
    const waiters: (() => void)[] = [];

    server.on("connection", (ws: WebSocket, request) => {
        const connection = wrap(ws, request.url ?? "/", request.headers);
        connections.push(connection);
        options.onConnect?.(connection, connections.length - 1);
        for (const wake of waiters.splice(0)) wake();
    });

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        connections,
        async connection(index = 0, timeout = 2000) {
            const deadline = Date.now() + timeout;
            while (!connections[index]) {
                const left = deadline - Date.now();
                if (left <= 0) {
                    throw new Error(`Timed out waiting for connection ${index}; ${connections.length} opened.`);
                }
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, left);
                    waiters.push(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
            }
            return connections[index] as FakeConnection;
        },
        close() {
            for (const ws of server.clients) ws.terminate();
            return new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

function wrap(ws: WebSocket, target: string, headers: NodeJS.Dict<string | string[]>): FakeConnection {
    const received: Frame[] = [];
    const waiters: (() => void)[] = [];
    let cursor = 0;
    let closed = false;

    const wake = () => {
        for (const resolve of waiters.splice(0)) resolve();
    };

    ws.on("message", (data: RawData, isBinary: boolean) => {
        received.push(isBinary ? toBytes(data) : data.toString());
        wake();
    });
    ws.on("close", () => {
        closed = true;
        wake();
    });

    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(", ") : value;
    }

    async function next(timeout = 2000): Promise<Frame> {
        const deadline = Date.now() + timeout;
        for (;;) {
            if (cursor < received.length) return received[cursor++] as Frame;
            const left = deadline - Date.now();
            if (left <= 0 || closed) {
                throw new Error(
                    `Timed out waiting for frame ${cursor}${closed ? " (socket closed)" : ""}. Received so far: ${describe(received)}`,
                );
            }
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, left);
                waiters.push(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
    }

    return {
        url: new URL(target, "http://127.0.0.1"),
        headers: flat,
        received,
        next,
        async nextJson<T>(timeout?: number) {
            const frame = await next(timeout);
            if (typeof frame !== "string") throw new Error("Expected a text frame, got binary.");
            return JSON.parse(frame) as T;
        },
        async nextMatching<T>(predicate: (message: T) => boolean, timeout = 2000) {
            const deadline = Date.now() + timeout;
            for (;;) {
                const frame = await next(Math.max(deadline - Date.now(), 0));
                if (typeof frame !== "string") continue;
                const message = JSON.parse(frame) as T;
                if (predicate(message)) return message;
            }
        },
        send(data) {
            if (typeof data === "string" || data instanceof Uint8Array) ws.send(data);
            else ws.send(JSON.stringify(data));
        },
        close(code, reason) {
            ws.close(code, reason);
        },
        json<T>() {
            return received.filter((frame): frame is string => typeof frame === "string").map((frame) => JSON.parse(frame) as T);
        },
    };
}

function toBytes(data: RawData): Uint8Array {
    if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function describe(frames: Frame[]): string {
    if (frames.length === 0) return "(nothing)";
    return frames.map((frame) => (typeof frame === "string" ? frame : `<${frame.byteLength} bytes>`)).join(", ");
}
