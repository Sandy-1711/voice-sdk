/**
 * Exercises the **built** package on the oldest node this repo supports.
 *
 * The unit suite cannot do this job: vitest 4 does not run on node 18, so
 * everything else in `test/` only ever proves the code works on node 22. CI's
 * `node18-imports` step is the other half, and it only imports — an import
 * never reaches the inside of a session constructor.
 *
 * That gap is not hypothetical. `crypto.randomUUID()` works on node 22 and
 * throws "crypto is not defined" on node 18, where the global does not exist
 * yet; the entire green unit suite missed it and this caught it. Anything that
 * reaches for a runtime global belongs under this script.
 *
 *   node providers/cartesia/test/node18/smoke.mjs
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CartesiaProvider } from "../../dist/index.mjs";

const AUDIO = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
const failures = [];

async function check(name, run) {
    try {
        await run();
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures.push(name);
        console.log(`  FAIL ${name}: ${error?.message ?? error}`);
    }
}

function deadline(promise, ms = 5000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
    ]);
}

// A stand-in for the REST surface: every endpoint the provider calls.
const http = createServer((request, response) => {
    const { pathname } = new URL(request.url, "http://x");
    request.resume();
    request.on("end", () => {
        const send = (body, headers = {}) => {
            response.writeHead(200, { "content-type": "application/json", ...headers });
            response.end(body);
        };

        if (pathname === "/tts/bytes") send(AUDIO, { "content-type": "audio/wav", "x-request-id": "req-1" });
        else if (pathname === "/tts/sse") {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ type: "chunk", data: AUDIO.toString("base64") })}\n\n`);
            response.end(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        } else if (pathname === "/stt") send(JSON.stringify({ text: "hello there", request_id: "r-1" }));
        else if (pathname === "/voices") send(JSON.stringify({ data: [{ id: "v1" }], has_more: false }));
        else response.writeHead(404).end("{}");
    });
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));

// And one for all three sockets.
const sockets = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const handshakes = [];
sockets.on("connection", (ws, request) => {
    handshakes.push({
        url: request.url,
        auth: request.headers["authorization"],
        version: request.headers["cartesia-version"],
    });

    ws.on("message", (raw, isBinary) => {
        if (request.url.startsWith("/tts/websocket")) {
            if (isBinary) return;
            ws.send(JSON.stringify({ type: "chunk", data: AUDIO.toString("base64") }));
            ws.send(JSON.stringify({ type: "done" }));
            return;
        }
        // Audio arrives binary, control words as text. Cartesia closes the
        // socket after the goodbye, which is what `close()` waits for.
        const text = isBinary ? "" : raw.toString();
        if (text === "close" || text.includes('"type":"close"')) return ws.close();
        ws.send(JSON.stringify({ type: "turn.end", transcript: "book a table" }));
    });
});
await new Promise((resolve) => sockets.once("listening", resolve));

const rest = new CartesiaProvider({
    apiKey: "k",
    defaultVoice: "v1",
    baseUrl: `http://127.0.0.1:${http.address().port}`,
});
const realtime = new CartesiaProvider({
    apiKey: "secret",
    defaultVoice: "v1",
    baseUrl: `http://127.0.0.1:${sockets.address().port}`,
});

console.log(`node ${process.version}\n`);

await check("speak", async () => {
    const result = await rest.speak({ text: "hi" });
    assert(result.audio.length === 8 && result.requestId === "req-1", "wrong payload");
});

await check("speakStream", async () => {
    const chunks = [];
    for await (const chunk of rest.speakStream({ text: "hi" })) chunks.push(chunk.data);
    assert(chunks.length === 1, `expected 1 chunk, got ${chunks.length}`);
});

await check("transcribe", async () => {
    const result = await rest.transcribe({ audio: new Uint8Array(AUDIO) });
    assert(result.text === "hello there", "wrong text");
});

await check("listVoices", async () => {
    const voices = await rest.listVoices();
    assert(voices[0]?.id === "v1", "wrong voices");
});

await check("openSTTSession", async () => {
    const session = await realtime.openSTTSession();
    const heard = (async () => {
        for await (const event of session.output) {
            if (event.type === "transcript" && event.finality === "turn_end") return event.text;
        }
    })();

    session.push(new Uint8Array(AUDIO));
    assert((await deadline(heard)) === "book a table", "did not hear the turn");
    await deadline(session.close());
});

await check("openTTSSession", async () => {
    const session = await realtime.openTTSSession();
    const events = (async () => {
        const seen = [];
        for await (const event of session.output) {
            seen.push(event.type);
            if (event.type === "done") return seen;
        }
        return seen;
    })();

    session.push("hello");
    assert((await deadline(events))[0] === "audio", "no audio came back");
    await deadline(session.close());
});

await check("auth reaches the socket handshake", () => {
    assert(handshakes.length === 2, `expected 2 sockets, saw ${handshakes.length}`);
    for (const { url, auth, version } of handshakes) {
        assert(auth === "Bearer secret", `auth was ${auth} on ${url}`);
        assert(version === "2025-11-04", `version was ${version} on ${url}`);
        assert(!url.includes("api_key"), "the key leaked into the url");
    }
});

http.close();
sockets.close();

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
