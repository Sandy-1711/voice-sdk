import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    assertSTTEvent,
    assertTurnSequence,
    collect,
    fakeSocket,
    pcmRamp,
    type FakeConnection,
    type FakeSocket,
} from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

async function eventsFrom(
    input: Parameters<CartesiaProvider["openSTTSession"]>[0],
    script: (connection: FakeConnection) => void,
) {
    const session = await provider().openSTTSession(input);
    const connection = await server.connection();

    script(connection);
    connection.close();

    const events = await collect(session.output);
    for (const event of events) assertSTTEvent(event);
    assertTurnSequence(events);
    return events;
}

beforeEach(async () => {
    server = await fakeSocket();
});

afterEach(async () => {
    await server.close();
});

/**
 * Cartesia splits realtime STT across two endpoints, and `turnDetection` picks
 * between them: auto (ink-2) detects turns, manual (ink-whisper) has no turn
 * detection at all and only transcribes when told to.
 */
describe("openSTTSession in auto mode", () => {
    it("connects to the turns endpoint with the vad model", async () => {
        await provider().openSTTSession();
        const { url } = await server.connection();

        expect(url.pathname).toBe("/stt/turns/websocket");
        expect(url.searchParams.get("model")).toBe("ink-2");
        expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
        expect(url.searchParams.get("sample_rate")).toBe("16000");
    });

    it("spells the turn settings out, converting silence into milliseconds", async () => {
        await provider().openSTTSession({
            turnDetection: { mode: "vad", threshold: 0.7, silence: 1.5 },
            keyterms: ["sdk"],
            inputFormat: { encoding: "mulaw", sampleRate: 8000 },
        });
        const { url } = await server.connection();

        expect(url.searchParams.get("turn_end_threshold")).toBe("0.7");
        expect(url.searchParams.get("turn_end_timeout_ms")).toBe("1500");
        expect(url.searchParams.getAll("keyterm")).toEqual(["sdk"]);
        expect(url.searchParams.get("encoding")).toBe("pcm_mulaw");
    });

    // ink-whisper has no turn detection, so asking for turns from it would
    // leave the caller waiting forever.
    it("refuses a manual-only model, naming the two ways out", async () => {
        await expect(provider().openSTTSession({ model: "ink-whisper" })).rejects.toMatchObject({
            name: "ValidationError",
            field: "model",
        });

        expect(server.connections).toHaveLength(0);
    });

    it("forwards pushed audio as binary frames", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();
        const audio = pcmRamp(8);

        session.push(audio);

        expect(await connection.next()).toEqual(audio);
    });

    it("has nothing to finalize, so flush sends nothing", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();

        await session.flush();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(connection.received).toHaveLength(0);
    });

    it("says goodbye on close", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();

        const closing = session.close();
        expect(await connection.nextJson()).toMatchObject({ type: "close" });
        connection.close();

        await expect(closing).resolves.toBeUndefined();
    });

    it("reports the connection as metadata and the turn start as speech", async () => {
        const events = await eventsFrom({}, (connection) => {
            connection.send({ type: "connected", request_id: "req-1" });
            connection.send({ type: "turn.start", request_id: "req-1" });
        });

        expect(events).toEqual([{ type: "metadata", requestId: "req-1" }, { type: "speech_started" }]);
    });

    // turn.eager_end is a predicted boundary turn.resume can revoke, so it is
    // a stable segment rather than the end of the turn.
    it("maps the turn lifecycle onto core's finality", async () => {
        const events = await eventsFrom({}, (connection) => {
            connection.send({ type: "turn.update", transcript: "book a" });
            connection.send({ type: "turn.eager_end", transcript: "book a table" });
            connection.send({ type: "turn.resume", transcript: "book a table" });
            connection.send({ type: "turn.end", transcript: "book a table for two" });
        });

        expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
            "partial",
            "final",
            "partial",
            "turn_end",
        ]);
    });

    it("derives the delta from a transcript that is re-sent whole each time", async () => {
        const events = await eventsFrom({}, (connection) => {
            connection.send({ type: "turn.update", transcript: "book a" });
            connection.send({ type: "turn.update", transcript: "book a table" });
        });

        expect(events.map((event) => event.type === "transcript" && event.delta)).toEqual([
            "book a",
            " table",
        ]);
    });

    it("starts a new turn after a turn.end", async () => {
        const events = await eventsFrom({}, (connection) => {
            connection.send({ type: "turn.end", transcript: "first" });
            connection.send({ type: "turn.update", transcript: "second" });
        });

        expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
        expect(events[1]).toMatchObject({ text: "second", delta: "second" });
    });

    it("fails the stream on an error message", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();

        connection.send({
            type: "error",
            title: "Bad audio",
            message: "unsupported encoding",
            status_code: 400,
        });

        await expect(collect(session.output)).rejects.toThrow(/Bad audio: unsupported encoding/);
    });
});

describe("openSTTSession in manual mode", () => {
    const MANUAL = { turnDetection: { mode: "manual" } } as const;

    it("connects to the plain endpoint with the manual model", async () => {
        await provider().openSTTSession(MANUAL);
        const { url } = await server.connection();

        expect(url.pathname).toBe("/stt/websocket");
        expect(url.searchParams.get("model")).toBe("ink-whisper");
    });

    // Manual mode transcribes only when told to.
    it("finalizes on flush", async () => {
        const session = await provider().openSTTSession(MANUAL);
        const connection = await server.connection();

        await session.flush();

        expect(await connection.next()).toBe("finalize");
    });

    it("says goodbye on close", async () => {
        const session = await provider().openSTTSession(MANUAL);
        const connection = await server.connection();

        const closing = session.close();
        expect(await connection.next()).toBe("close");
        connection.close();

        await expect(closing).resolves.toBeUndefined();
    });

    it("accumulates segments into one cumulative turn", async () => {
        const events = await eventsFrom(MANUAL, (connection) => {
            connection.send({ type: "transcript", text: "hello there", is_final: true, request_id: "r" });
            connection.send({ type: "transcript", text: " how are you", is_final: false, request_id: "r" });
        });

        expect(events.map((event) => event.type === "transcript" && event.text)).toEqual([
            "hello there",
            "hello there how are you",
        ]);
        expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
            "final",
            "partial",
        ]);
    });

    // The caller declared the turn over and the server has now drained it,
    // which is the closest thing manual mode has to a turn boundary.
    it("turns flush_done into the end of the turn", async () => {
        const events = await eventsFrom(MANUAL, (connection) => {
            connection.send({ type: "transcript", text: "hello there", is_final: true, request_id: "r" });
            connection.send({ type: "flush_done", request_id: "r" });
            connection.send({ type: "transcript", text: "next turn", is_final: false, request_id: "r" });
        });

        expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
            "final",
            "turn_end",
            "partial",
        ]);
        expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 0, 1]);
        expect(events[1]).toMatchObject({ text: "hello there", delta: "" });
    });

    it("carries the words and language through", async () => {
        const events = await eventsFrom(MANUAL, (connection) => {
            connection.send({
                type: "transcript",
                text: "hello",
                is_final: true,
                language: "en",
                words: [{ word: "hello", start: 0.1, end: 0.5 }],
                request_id: "r",
            });
        });

        expect(events[0]).toMatchObject({
            language: "en",
            words: [{ text: "hello", start: 0.1, end: 0.5 }],
        });
    });

    it("ends the stream on done", async () => {
        const session = await provider().openSTTSession(MANUAL);
        const connection = await server.connection();

        connection.send({ type: "transcript", text: "hello", is_final: true, request_id: "r" });
        connection.send({ type: "done", request_id: "r" });

        const events = await collect(session.output);

        expect(events).toHaveLength(1);
    });

    it("fails the stream on an error message", async () => {
        const session = await provider().openSTTSession(MANUAL);
        const connection = await server.connection();

        connection.send({
            type: "error",
            title: "Bad audio",
            message: "unsupported encoding",
            status_code: 400,
        });

        await expect(collect(session.output)).rejects.toThrow(/Bad audio: unsupported encoding/);
    });
});
