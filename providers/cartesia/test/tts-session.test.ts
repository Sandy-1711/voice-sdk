import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@swungstudent/voice";
import {
    assertTTSEvent,
    collect,
    fakeSocket,
    pcmRamp,
    type FakeConnection,
    type FakeSocket,
} from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new CartesiaProvider({
        apiKey: "k",
        defaultVoice: "voice-1",
        baseUrl: server.baseUrl,
        ...config,
    });
}

/**
 * Cartesia has no handshake frame — the context configuration rides on every
 * generation request — so a push is what puts the mapped request on the wire.
 */
async function firstFrame(input: Parameters<CartesiaProvider["openTTSSession"]>[0] = {}) {
    const session = await provider().openTTSSession(input);
    const connection = await server.connection();

    session.push("hi");
    return connection.nextJson<Record<string, unknown>>();
}

beforeEach(async () => {
    server = await fakeSocket();
});

afterEach(async () => {
    await server.close();
});

describe("opening", () => {
    it("connects to the synthesis endpoint", async () => {
        await provider().openTTSSession();

        expect((await server.connection()).url.pathname).toBe("/tts/websocket");
    });

    it("authenticates in the handshake headers rather than the query", async () => {
        await provider({ apiKey: "secret-key" }).openTTSSession();
        const connection = await server.connection();

        expect(connection.headers["authorization"]).toBe("Bearer secret-key");
        expect(connection.headers["cartesia-version"]).toBe("2025-11-04");
        expect(connection.url.searchParams.has("api_key")).toBe(false);
    });

    it("rejects from open() when the socket never connects", async () => {
        const unreachable = new CartesiaProvider({
            apiKey: "k",
            defaultVoice: "voice-1",
            baseUrl: "http://127.0.0.1:1",
        });

        await expect(unreachable.openTTSSession()).rejects.toThrow(/socket failed to open/);
    });

    it("configures the context with the mapped request", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();
        session.push("hi");

        expect(await connection.nextJson()).toMatchObject({
            model_id: "sonic-3.5",
            voice: { mode: "id", id: "voice-1" },
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
            add_timestamps: false,
            add_phoneme_timestamps: false,
        });
        // Streamed audio goes to a speaker, where a header is noise.
        expect(session.format).toEqual({
            container: "raw",
            encoding: "pcm_s16le",
            sampleRate: 44100,
            channels: 1,
        });
    });

    it("carries the model, voice and language a call names", async () => {
        expect(
            await firstFrame({
                model: "sonic-2",
                voice: "voice-2",
                language: "es",
                format: { sampleRate: 24000 },
            }),
        ).toMatchObject({
            model_id: "sonic-2",
            voice: { mode: "id", id: "voice-2" },
            language: "es",
            output_format: { sample_rate: 24000 },
        });
    });

    it("asks for the granularity of timings the caller wanted", async () => {
        expect(await firstFrame({ timings: "word" })).toMatchObject({
            add_timestamps: true,
            add_phoneme_timestamps: false,
        });

        const phoneme = await provider().openTTSSession({ timings: "phoneme" });
        const connection = await server.connection(1);
        phoneme.push("hi");

        expect(await connection.nextJson()).toMatchObject({
            add_timestamps: false,
            add_phoneme_timestamps: true,
        });
    });

    // Unlike speak(), here output_format sits inside the merge, so
    // providerOptions can tweak one field without dropping its siblings.
    it("lets providerOptions merge into the mapped output format", async () => {
        expect(
            await firstFrame({
                format: { sampleRate: 44100 },
                providerOptions: { output_format: { sample_rate: 24000 }, max_buffer_delay_ms: 100 },
            }),
        ).toMatchObject({
            max_buffer_delay_ms: 100,
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
        });
    });

    it("refuses a framed container, which the socket cannot emit", async () => {
        await expect(provider().openTTSSession({ format: { container: "wav" } })).rejects.toMatchObject({
            name: "ValidationError",
            field: "format.container",
        });

        expect(server.connections).toHaveLength(0);
    });

    it("refuses to guess a voice", async () => {
        const bare = new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl });

        await expect(bare.openTTSSession()).rejects.toMatchObject({
            name: "ValidationError",
            field: "voice",
        });

        expect(server.connections).toHaveLength(0);
    });
});

describe("sending", () => {
    it("pushes the transcript with the generation config", async () => {
        const session = await provider().openTTSSession({ controls: { speed: 1.2 } });
        const connection = await server.connection();

        session.push("Hello ");
        session.push("there.");

        expect(await connection.nextJson()).toMatchObject({
            transcript: "Hello ",
            generation_config: { speed: 1.2 },
            continue: true,
        });
        expect(await connection.nextJson()).toMatchObject({
            transcript: "there.",
            generation_config: { speed: 1.2 },
        });
    });

    it("sends no generation config when there are no controls", async () => {
        const frame = await firstFrame();

        expect(frame).toMatchObject({ transcript: "hi" });
        expect(frame).not.toHaveProperty("generation_config");
    });

    // Every request repeats the context configuration, keyed by context_id.
    it("keys every request to one context", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        session.push("hi");
        await session.flush();

        const push = await connection.nextJson<{ context_id: string }>();
        const flush = await connection.nextJson<{ context_id: string }>();
        expect(push.context_id).toEqual(expect.any(String));
        expect(flush.context_id).toBe(push.context_id);
    });

    it("synthesizes what is buffered on flush", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        await session.flush();

        expect(await connection.nextJson()).toMatchObject({
            transcript: "",
            continue: true,
            flush: true,
        });
    });

    it("drops queued audio on cancel, keeping the context alive", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        session.cancel();

        expect(await connection.nextJson()).toMatchObject({ cancel: true });
        // The socket stays up, so the caller can keep pushing.
        session.push("still here");
        expect(await connection.nextJson()).toMatchObject({ transcript: "still here" });
    });

    it("declares the input finished and closes the socket on close", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        const closing = session.close();

        expect(await connection.nextJson()).toMatchObject({ transcript: "", continue: false });
        await expect(closing).resolves.toBeUndefined();
        await expect(session.closed).resolves.toBeUndefined();
    });
});

describe("receiving", () => {
    async function eventsFrom(script: (connection: FakeConnection) => void) {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        script(connection);
        connection.close();

        const events = await collect(session.output);
        for (const event of events) assertTTSEvent(event);
        return events;
    }

    it("decodes base64 chunks into audio", async () => {
        const audio = pcmRamp(8);

        const events = await eventsFrom((connection) => {
            connection.send({ type: "chunk", data: encodeBase64(audio) });
            connection.send({ type: "done" });
        });

        expect(events.map((event) => event.type)).toEqual(["audio", "done"]);
        expect(events[0]).toMatchObject({ data: audio });
    });

    // Cartesia returns parallel arrays; core carries spans.
    it("turns word timestamps into spans", async () => {
        const events = await eventsFrom((connection) => {
            connection.send({
                type: "timestamps",
                word_timestamps: { words: ["hello", "there"], start: [0, 0.5], end: [0.5, 1] },
            });
        });

        expect(events[0]).toEqual({
            type: "timing",
            alignment: {
                unit: "word",
                spans: [
                    { text: "hello", start: 0, end: 0.5 },
                    { text: "there", start: 0.5, end: 1 },
                ],
            },
        });
    });

    it("turns phoneme timestamps into spans of their own unit", async () => {
        const events = await eventsFrom((connection) => {
            connection.send({
                type: "phoneme_timestamps",
                phoneme_timestamps: { phonemes: ["h", "E"], start: [0, 0.1], end: [0.1, 0.2] },
            });
        });

        expect(events[0]).toMatchObject({ type: "timing", alignment: { unit: "phoneme" } });
    });

    it("reports a flush landing with the id Cartesia gave it", async () => {
        const events = await eventsFrom((connection) => connection.send({ type: "flush_done", flush_id: 2 }));

        expect(events[0]).toEqual({ type: "flushed", id: 2 });
    });

    it("ignores message types core has no equivalent for", async () => {
        const events = await eventsFrom((connection) => connection.send({ type: "something_new" }));

        expect(events).toEqual([]);
    });

    // One session owns one context, so a message for another is not ours.
    it("ignores a message addressed to a different context", async () => {
        const events = await eventsFrom((connection) => {
            connection.send({ type: "chunk", data: encodeBase64(pcmRamp(8)), context_id: "somebody-else" });
        });

        expect(events).toEqual([]);
    });

    it("fails the stream on an error message", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        connection.send({ type: "error", title: "Bad voice", message: "no such voice id" });

        await expect(collect(session.output)).rejects.toThrow(/Bad voice: no such voice id/);
    });

    it("fails the stream on a frame that is not JSON", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        connection.send("not json");

        await expect(collect(session.output)).rejects.toThrow(/invalid JSON/);
    });
});
