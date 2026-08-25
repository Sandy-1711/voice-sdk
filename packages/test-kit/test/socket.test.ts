import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { fakeSocket, type FakeSocket, type FakeSocketOptions } from "../src/index";

let server: FakeSocket;
const clients: WebSocket[] = [];

async function serve(options: FakeSocketOptions = {}) {
    server = await fakeSocket(options);
    return server;
}

/** Connects a client and waits for the handshake, so sends cannot race it. */
function connect(path = "/"): Promise<WebSocket> {
    const ws = new WebSocket(`${server.baseUrl.replace("http:", "ws:")}${path}`);
    clients.push(ws);
    return new Promise((resolve, reject) => {
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
    });
}

/** RawData is a union, and only Buffer has a toString() that decodes. */
function text(data: WebSocket.RawData): string {
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    return new TextDecoder().decode(data);
}

afterEach(async () => {
    for (const ws of clients.splice(0)) {
        // A client still mid-handshake errors on terminate, and the test is over.
        ws.on("error", () => {});
        ws.terminate();
    }
    await server.close();
});

describe("connecting", () => {
    it("records the url and headers of the handshake", async () => {
        await serve();
        await connect("/v1/listen?model=nova-3");

        const connection = await server.connection();

        expect(connection.url.pathname).toBe("/v1/listen");
        expect(connection.url.searchParams.get("model")).toBe("nova-3");
        expect(connection.headers["sec-websocket-version"]).toBeDefined();
    });

    // Sessions open their socket lazily, so a test reaches for the connection
    // before the client has made it.
    it("waits for a connection that has not opened yet", async () => {
        await serve();

        const waiting = server.connection();
        setTimeout(() => void connect().catch(() => {}), 20);

        await expect(waiting).resolves.toBeDefined();
    });

    it("waits for the nth connection, not just the first", async () => {
        await serve();
        await connect("/first");

        const waiting = server.connection(1);
        await connect("/second");

        expect((await waiting).url.pathname).toBe("/second");
    });

    it("times out saying how many opened", async () => {
        await serve();
        await connect();

        await expect(server.connection(2, 50)).rejects.toThrow(
            /Timed out waiting for connection 2; 1 opened\./,
        );
    });

    it("runs onConnect with the connection and its index", async () => {
        const seen: number[] = [];
        await serve({ onConnect: (connection, index) => seen.push(index) });

        await connect();
        await connect();
        await server.connection(1);

        expect(seen).toEqual([0, 1]);
    });

    // Scripting a server-first protocol means replying inside onConnect, before
    // the test has had a chance to await anything.
    it("lets onConnect answer immediately", async () => {
        await serve({ onConnect: (connection) => connection.send({ type: "connected" }) });

        // The listener goes on before the handshake, since the reply is already
        // in flight by the time "open" fires.
        const ws = new WebSocket(server.baseUrl.replace("http:", "ws:"));
        clients.push(ws);
        const first = await new Promise((resolve) => ws.on("message", resolve));

        expect(JSON.parse(String(first))).toEqual({ type: "connected" });
    });
});

describe("frames the client sends", () => {
    it("keeps a text frame as a string", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send("hello");

        expect(await connection.next()).toBe("hello");
    });

    // The bug this pins: decoding with toString() yields "[object ArrayBuffer]"
    // for the shapes ws delivers, so a binary frame has to come back as bytes.
    it("keeps a binary frame as bytes", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(new Uint8Array([1, 2, 250]));

        const frame = await connection.next();
        expect(frame).toBeInstanceOf(Uint8Array);
        expect(frame).toEqual(new Uint8Array([1, 2, 250]));
    });

    it("decodes text as utf-8 rather than bytes", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send("héllo → ok");

        expect(await connection.next()).toBe("héllo → ok");
    });

    it("hands frames back in order, one per call", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send("one");
        ws.send("two");

        expect(await connection.next()).toBe("one");
        expect(await connection.next()).toBe("two");
        expect(connection.received).toEqual(["one", "two"]);
    });

    it("parses a text frame as JSON", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(JSON.stringify({ type: "Speak", text: "hi" }));

        expect(await connection.nextJson()).toEqual({ type: "Speak", text: "hi" });
    });

    it("refuses to parse a binary frame as JSON", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(new Uint8Array([1, 2]));

        await expect(connection.nextJson()).rejects.toThrow("Expected a text frame, got binary.");
    });
});

describe("nextMatching", () => {
    it("consumes everything before the frame it wants", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(JSON.stringify({ type: "KeepAlive" }));
        ws.send(JSON.stringify({ type: "KeepAlive" }));
        ws.send(JSON.stringify({ type: "Close" }));

        const found = await connection.nextMatching<{ type: string }>((m) => m.type === "Close");

        expect(found).toEqual({ type: "Close" });
        // The skipped frames are consumed, not left for the next call.
        await expect(connection.next(50)).rejects.toThrow(/Timed out/);
    });

    // Audio rides on the same socket as the control messages, so a search for a
    // JSON message has to step over the binary frames between them.
    it("steps over binary frames", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(new Uint8Array([1, 2, 3]));
        ws.send(JSON.stringify({ type: "Flushed" }));

        await expect(connection.nextMatching<{ type: string }>((m) => m.type === "Flushed")).resolves.toEqual(
            { type: "Flushed" },
        );
    });

    it("times out when no frame ever matches", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(JSON.stringify({ type: "KeepAlive" }));

        await expect(connection.nextMatching(() => false, 50)).rejects.toThrow(/Timed out/);
    });
});

describe("timeouts", () => {
    // The point of the message is that a test that hangs tells you what the
    // socket did see, rather than just that it waited.
    it("reports the frames seen so far", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send("first");
        ws.send(new Uint8Array([1, 2, 3, 4]));
        await connection.next();
        await connection.next();

        await expect(connection.next(50)).rejects.toThrow(
            /Timed out waiting for frame 2\. Received so far: first, <4 bytes>/,
        );
    });

    it("says so when nothing arrived at all", async () => {
        await serve();
        await connect();
        const connection = await server.connection();

        await expect(connection.next(50)).rejects.toThrow(/Received so far: \(nothing\)/);
    });

    it("gives up early once the socket has closed", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.close();
        await new Promise((resolve) => setTimeout(resolve, 50));

        await expect(connection.next(10_000)).rejects.toThrow(/\(socket closed\)/);
    });
});

describe("frames the server sends", () => {
    async function received(send: (connection: Awaited<ReturnType<FakeSocket["connection"]>>) => void) {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        const arrived = new Promise<{ data: WebSocket.RawData; binary: boolean }>((resolve) => {
            ws.on("message", (data, binary) => resolve({ data, binary }));
        });
        send(connection);
        return arrived;
    }

    it("sends an object as JSON text", async () => {
        const { data, binary } = await received((connection) => connection.send({ type: "Metadata" }));

        expect(binary).toBe(false);
        expect(JSON.parse(text(data))).toEqual({ type: "Metadata" });
    });

    it("sends a string verbatim", async () => {
        const { data, binary } = await received((connection) => connection.send("finalize"));

        expect(binary).toBe(false);
        expect(text(data)).toBe("finalize");
    });

    it("sends bytes as a binary frame", async () => {
        const { data, binary } = await received((connection) => connection.send(new Uint8Array([9, 8, 7])));

        expect(binary).toBe(true);
        expect(new Uint8Array(data as ArrayBufferLike)).toEqual(new Uint8Array([9, 8, 7]));
    });

    it("closes with the code and reason it was given", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        const closed = new Promise<[number, string]>((resolve) => {
            ws.on("close", (code, reason) => resolve([code, reason.toString()]));
        });
        connection.close(4001, "done here");

        expect(await closed).toEqual([4001, "done here"]);
    });
});

describe("json()", () => {
    it("parses every text frame at once", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(JSON.stringify({ n: 1 }));
        ws.send(JSON.stringify({ n: 2 }));
        await connection.next();
        await connection.next();

        expect(connection.json()).toEqual([{ n: 1 }, { n: 2 }]);
    });

    // Audio shares the socket, so including binary frames would throw on parse.
    it("leaves binary frames out", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(new Uint8Array([1, 2]));
        ws.send(JSON.stringify({ n: 1 }));
        await connection.next();
        await connection.next();

        expect(connection.json()).toEqual([{ n: 1 }]);
    });

    it("reads frames the test never consumed", async () => {
        await serve();
        const ws = await connect();
        const connection = await server.connection();

        ws.send(JSON.stringify({ n: 1 }));
        await connection.next();
        ws.send(JSON.stringify({ n: 2 }));
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(connection.json()).toEqual([{ n: 1 }, { n: 2 }]);
    });
});
