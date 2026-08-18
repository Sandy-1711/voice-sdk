import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    assertSTTEvent,
    assertTurnSequence,
    collect,
    fakeSocket,
    pcmRamp,
    type FakeConnection,
    type FakeSocket,
} from "@voice-sdk/test-kit";
import { DeepgramProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

/** Scripts a session, then drains it once the far side hangs up. */
async function eventsFrom(input: Parameters<DeepgramProvider["openSTTSession"]>[0], script: (connection: FakeConnection) => void) {
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
    vi.useRealTimers();
    await server.close();
});

describe("openSTTSession on nova-3", () => {
    describe("handshake", () => {
        it("connects to /v1/listen with the token and a fully named input format", async () => {
            await provider().openSTTSession();
            const { url, headers } = await server.connection();

            expect(url.pathname).toBe("/v1/listen");
            expect(headers.authorization).toBe("Token k");
            expect(url.searchParams.get("model")).toBe("nova-3");
            // A live socket has nothing to sniff, so both fields are required.
            expect(url.searchParams.get("encoding")).toBe("linear16");
            expect(url.searchParams.get("sample_rate")).toBe("16000");
        });

        it("carries language, interim results, diarization and keyterms", async () => {
            await provider().openSTTSession({
                language: "es",
                interimResults: true,
                diarize: true,
                keyterms: ["voice", "sdk"],
                inputFormat: { encoding: "mulaw", sampleRate: 8000 },
            });
            const { url } = await server.connection();

            expect(url.searchParams.get("language")).toBe("es");
            expect(url.searchParams.get("interim_results")).toBe("true");
            expect(url.searchParams.get("diarize")).toBe("true");
            expect(url.searchParams.getAll("keyterm")).toEqual(["voice", "sdk"]);
            expect(url.searchParams.get("encoding")).toBe("mulaw");
            expect(url.searchParams.get("sample_rate")).toBe("8000");
        });

        it("turns a vad silence window into endpointing, in milliseconds", async () => {
            await provider().openSTTSession({ turnDetection: { mode: "vad", silence: 1.2 } });
            const { url } = await server.connection();

            expect(url.searchParams.get("endpointing")).toBe("1200");
            expect(url.searchParams.get("utterance_end_ms")).toBe("1200");
            expect(url.searchParams.get("vad_events")).toBe("true");
        });

        // Deepgram rejects an utterance window under a second, so it is only
        // requested when the caller's silence window is actually valid.
        it("omits utterance_end_ms for a sub-second window rather than being rejected", async () => {
            await provider().openSTTSession({ turnDetection: { mode: "vad", silence: 0.5 } });
            const { url } = await server.connection();

            expect(url.searchParams.get("endpointing")).toBe("500");
            expect(url.searchParams.has("utterance_end_ms")).toBe(false);
        });

        it("switches Deepgram's endpointer off entirely in manual mode", async () => {
            await provider().openSTTSession({ turnDetection: { mode: "manual" } });
            const { url } = await server.connection();

            expect(url.searchParams.get("endpointing")).toBe("false");
            expect(url.searchParams.has("vad_events")).toBe(false);
            expect(url.searchParams.has("utterance_end_ms")).toBe(false);
        });

        it("lets providerOptions reach the query", async () => {
            await provider().openSTTSession({ providerOptions: { smart_format: true } });
            const { url } = await server.connection();

            expect(url.searchParams.get("smart_format")).toBe("true");
        });
    });

    describe("sending", () => {
        it("forwards pushed audio as binary frames", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();
            const audio = pcmRamp(8);

            session.push(audio);

            expect(await connection.next()).toEqual(audio);
        });

        it("finalizes what is buffered on flush", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            await session.flush();

            expect(await connection.nextJson()).toEqual({ type: "Finalize" });
        });

        it("closes the stream on close", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            const closing = session.close();
            expect(await connection.nextJson()).toEqual({ type: "CloseStream" });
            connection.close();

            await expect(closing).resolves.toBeUndefined();
        });

        // Deepgram drops an idle socket, so the heartbeat has to stay well
        // inside its ten second window.
        it("heartbeats to keep an idle socket alive", async () => {
            vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

            await provider().openSTTSession();
            const connection = await server.connection();

            vi.advanceTimersByTime(8000);

            expect(await connection.nextJson()).toEqual({ type: "KeepAlive" });
        });
    });

    describe("receiving", () => {
        it("maps the two levels of finality onto core's three", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ type: "Results", channel: { alternatives: [{ transcript: "hello" }] } });
                connection.send({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "hello there" }] } });
                connection.send({
                    type: "Results",
                    is_final: true,
                    speech_final: true,
                    channel: { alternatives: [{ transcript: " how are you" }] },
                });
            });

            expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
                "partial",
                "final",
                "turn_end",
            ]);
        });

        // nova-3 scopes its text to a segment, so each final has to be
        // committed before the next segment is appended to the turn.
        it("accumulates segments into one cumulative turn", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "hello there" }] } });
                connection.send({
                    type: "Results",
                    is_final: true,
                    speech_final: true,
                    channel: { alternatives: [{ transcript: " how are you" }] },
                });
            });

            expect(events.map((event) => event.type === "transcript" && event.text)).toEqual([
                "hello there",
                "hello there how are you",
            ]);
            expect(events.map((event) => event.type === "transcript" && event.delta)).toEqual([
                "hello there",
                " how are you",
            ]);
        });

        it("starts a new turn after the endpointer fires", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({
                    type: "Results",
                    is_final: true,
                    speech_final: true,
                    channel: { alternatives: [{ transcript: "first" }] },
                });
                connection.send({ type: "Results", channel: { alternatives: [{ transcript: "second" }] } });
            });

            expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
            expect(events[1]).toMatchObject({ text: "second" });
        });

        it("carries words, language and confidence through", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({
                    type: "Results",
                    is_final: true,
                    channel: {
                        alternatives: [
                            {
                                transcript: "hello",
                                confidence: 0.97,
                                languages: ["en"],
                                words: [{ word: "hello", start: 0.1, end: 0.5, speaker: 0 }],
                            },
                        ],
                    },
                });
            });

            expect(events[0]).toMatchObject({
                confidence: 0.97,
                language: "en",
                words: [{ text: "hello", start: 0.1, end: 0.5, speaker: "0" }],
            });
        });

        it("drops the words when the caller asked for no timestamps", async () => {
            const events = await eventsFrom({ timestamps: false }, (connection) => {
                connection.send({
                    type: "Results",
                    channel: { alternatives: [{ transcript: "hello", words: [{ word: "hello", start: 0, end: 1 }] }] },
                });
            });

            expect(events[0]).toMatchObject({ words: undefined });
        });

        it("reports the vad events as speech boundaries", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ type: "SpeechStarted", timestamp: 1.5 });
                connection.send({ type: "UtteranceEnd", last_word_end: 3.25 });
            });

            expect(events).toEqual([
                { type: "speech_started", at: 1.5 },
                { type: "speech_ended", at: 3.25 },
            ]);
        });

        it("reports the request id as metadata", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ type: "Metadata", metadata: { request_id: "req-3" } });
            });

            expect(events[0]).toMatchObject({ type: "metadata", requestId: "req-3" });
        });

        it("fails the stream on an error message", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            connection.send({ type: "Error", code: "INVALID_AUDIO", description: "bad frame" });

            await expect(collect(session.output)).rejects.toThrow(/INVALID_AUDIO: bad frame/);
        });

        it("fails the stream on a frame that is not JSON", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            connection.send("<html>");

            await expect(collect(session.output)).rejects.toThrow(/invalid JSON/);
        });
    });

    // Deepgram has no server-side discard, so this is a local reset only.
    it("drops the in-progress turn on cancel", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();

        connection.send({ type: "Results", channel: { alternatives: [{ transcript: "half a sen" }] } });
        await new Promise((resolve) => setTimeout(resolve, 20));
        session.cancel();
        connection.send({ type: "Results", channel: { alternatives: [{ transcript: "starting over" }] } });
        connection.close();

        const events = await collect(session.output);

        expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
        expect(events[1]).toMatchObject({ text: "starting over", delta: "starting over" });
    });
});

describe("openSTTSession on flux", () => {
    const FLUX = { model: "flux-general-en" };

    it("connects to /v2/listen and spells the turn settings Flux's way", async () => {
        await provider().openSTTSession({
            ...FLUX,
            language: "en",
            keyterms: ["sdk"],
            turnDetection: { mode: "vad", threshold: 0.7, silence: 1.5 },
        });
        const { url } = await server.connection();

        expect(url.pathname).toBe("/v2/listen");
        expect(url.searchParams.get("model")).toBe("flux-general-en");
        expect(url.searchParams.get("language_hint")).toBe("en");
        expect(url.searchParams.get("eot_threshold")).toBe("0.7");
        expect(url.searchParams.get("eot_timeout_ms")).toBe("1500");
        expect(url.searchParams.getAll("keyterm")).toEqual(["sdk"]);
    });

    // Flux would simply never honour a flush(), and the caller would wait for
    // turns forever - so this has to fail loudly at open time.
    it("refuses manual turn detection, which it cannot honour", async () => {
        await expect(
            provider().openSTTSession({ ...FLUX, turnDetection: { mode: "manual" } }),
        ).rejects.toMatchObject({ name: "ValidationError", field: "turnDetection" });

        expect(server.connections).toHaveLength(0);
    });

    it("has nothing to finalize, so flush sends nothing", async () => {
        const session = await provider().openSTTSession(FLUX);
        const connection = await server.connection();

        await session.flush();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(connection.received).toHaveLength(0);
    });

    it("needs no heartbeat", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

        await provider().openSTTSession(FLUX);
        const connection = await server.connection();
        vi.advanceTimersByTime(30_000);
        vi.useRealTimers();

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(connection.received).toHaveLength(0);
    });

    it("reports the connection as metadata and the turn start as speech", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({ type: "Connected", request_id: "req-flux" });
            connection.send({ type: "TurnInfo", event: "StartOfTurn", audio_window_start: 0.5 });
        });

        expect(events).toEqual([
            { type: "metadata", requestId: "req-flux", raw: { type: "Connected", request_id: "req-flux" } },
            { type: "speech_started", at: 0.5 },
        ]);
    });

    // EagerEndOfTurn is a prediction TurnResumed can revoke, so it is a stable
    // segment rather than the end of the turn.
    it("maps the turn lifecycle onto core's finality", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({ type: "TurnInfo", event: "Update", transcript: "book a" });
            connection.send({ type: "TurnInfo", event: "EagerEndOfTurn", transcript: "book a table" });
            connection.send({ type: "TurnInfo", event: "TurnResumed", transcript: "book a table for" });
            connection.send({ type: "TurnInfo", event: "EndOfTurn", transcript: "book a table for two" });
        });

        expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
            "partial",
            "final",
            "partial",
            "turn_end",
        ]);
    });

    it("derives the delta from a transcript that is re-sent whole each time", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({ type: "TurnInfo", event: "Update", transcript: "book a" });
            connection.send({ type: "TurnInfo", event: "Update", transcript: "book a table" });
        });

        expect(events.map((event) => event.type === "transcript" && event.delta)).toEqual(["book a", " table"]);
    });

    it("carries the audio window and the end-of-turn confidence", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({
                type: "TurnInfo",
                event: "EndOfTurn",
                transcript: "hello",
                audio_window_start: 0.2,
                audio_window_end: 1.4,
                end_of_turn_confidence: 0.93,
                languages: ["en"],
            });
        });

        expect(events[0]).toMatchObject({ start: 0.2, end: 1.4, endOfTurnConfidence: 0.93, language: "en" });
    });

    it("starts a new turn after an EndOfTurn", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({ type: "TurnInfo", event: "EndOfTurn", transcript: "first" });
            connection.send({ type: "TurnInfo", event: "Update", transcript: "second" });
        });

        expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
        expect(events[1]).toMatchObject({ text: "second", delta: "second" });
    });

    it("ignores lifecycle events core has no equivalent for", async () => {
        const events = await eventsFrom(FLUX, (connection) => {
            connection.send({ type: "TurnInfo", event: "SomethingNew", transcript: "ignored" });
        });

        expect(events).toEqual([]);
    });

    it("fails the stream on a fatal message", async () => {
        const session = await provider().openSTTSession(FLUX);
        const connection = await server.connection();

        connection.send({ type: "Fatal", code: "TOO_LONG", description: "session exceeded the limit" });

        await expect(collect(session.output)).rejects.toThrow(/TOO_LONG/);
    });
});
