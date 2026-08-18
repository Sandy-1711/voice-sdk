import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeBase64 } from "@voice-sdk/core";
import {
    assertSTTEvent,
    assertTurnSequence,
    collect,
    fakeSocket,
    pcmRamp,
    type FakeConnection,
    type FakeSocket,
} from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new ElevenLabsProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

async function eventsFrom(
    input: Parameters<ElevenLabsProvider["openSTTSession"]>[0],
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

describe("openSTTSession", () => {
    describe("handshake", () => {
        it("connects with the key and the default realtime model", async () => {
            await provider().openSTTSession();
            const { url, headers } = await server.connection();

            expect(url.pathname).toBe("/v1/speech-to-text/realtime");
            expect(headers["xi-api-key"]).toBe("k");
            expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
            expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
        });

        it("carries language, timestamps and keyterms", async () => {
            await provider().openSTTSession({
                language: "es",
                timestamps: true,
                keyterms: ["voice", "sdk"],
                inputFormat: { encoding: "mulaw" },
            });
            const { url } = await server.connection();

            expect(url.searchParams.get("language_code")).toBe("es");
            expect(url.searchParams.get("include_timestamps")).toBe("true");
            expect(url.searchParams.getAll("keyterms")).toEqual(["voice", "sdk"]);
            expect(url.searchParams.get("audio_format")).toBe("ulaw_8000");
        });

        it("defaults to letting ElevenLabs detect turns", async () => {
            await provider().openSTTSession();

            expect((await server.connection()).url.searchParams.get("commit_strategy")).toBe("vad");
        });

        // Manual mode leaves turn boundaries to the caller's flush().
        it("switches to manual commits when the caller wants the boundaries", async () => {
            await provider().openSTTSession({ turnDetection: { mode: "manual" } });

            expect((await server.connection()).url.searchParams.get("commit_strategy")).toBe("manual");
        });

        it("spells the vad settings out, converting minimum speech into milliseconds", async () => {
            await provider().openSTTSession({
                turnDetection: { mode: "vad", threshold: 0.6, silence: 1.5, minSpeech: 0.25 },
            });
            const { url } = await server.connection();

            expect(url.searchParams.get("vad_threshold")).toBe("0.6");
            expect(url.searchParams.get("vad_silence_threshold_secs")).toBe("1.5");
            expect(url.searchParams.get("min_speech_duration_ms")).toBe("250");
        });

        it("sends only the vad knobs the caller actually set", async () => {
            await provider().openSTTSession({ turnDetection: { mode: "vad" } });
            const { url } = await server.connection();

            expect(url.searchParams.has("vad_threshold")).toBe(false);
            expect(url.searchParams.has("vad_silence_threshold_secs")).toBe(false);
        });

        it("lets providerOptions reach the query", async () => {
            await provider().openSTTSession({ providerOptions: { tag_audio_events: true } });

            expect((await server.connection()).url.searchParams.get("tag_audio_events")).toBe("true");
        });
    });

    describe("sending", () => {
        it("base64-encodes pushed audio into a chunk message", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();
            const audio = pcmRamp(8);

            session.push(audio);

            const message = await connection.nextJson<{ message_type: string; audio_base_64: string }>();
            expect(message.message_type).toBe("input_audio_chunk");
            expect(decodeBase64(message.audio_base_64)).toEqual(audio);
        });

        // An empty chunk with commit is what closes the turn in manual mode.
        it("commits an empty chunk on flush", async () => {
            const session = await provider().openSTTSession({ turnDetection: { mode: "manual" } });
            const connection = await server.connection();

            await session.flush();

            expect(await connection.nextJson()).toEqual({
                message_type: "input_audio_chunk",
                audio_base_64: "",
                commit: true,
            });
        });

        // The socket opens in the constructor, so a caller that closes straight
        // away arrives mid-handshake - which used to leave close() awaiting a
        // socket nobody ever shut.
        it("closes cleanly even when called during the handshake", async () => {
            const session = await provider().openSTTSession();
            await server.connection();

            await expect(session.close()).resolves.toBeUndefined();
            await expect(session.closed).resolves.toBeUndefined();
        });

        it("closes cleanly once the socket has settled", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();
            session.push(pcmRamp(4));
            await connection.next();

            await expect(session.close()).resolves.toBeUndefined();
        });
    });

    describe("receiving", () => {
        it("reports the session id as metadata", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ message_type: "session_started", session_id: "sess-1" });
            });

            expect(events[0]).toMatchObject({ type: "metadata", requestId: "sess-1" });
        });

        // ElevenLabs is the one provider whose finality model maps onto core's
        // without inventing anything.
        it("maps partial, final and committed straight onto core's three", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ message_type: "partial_transcript", text: "book a" });
                connection.send({ message_type: "final_transcript", text: "book a table" });
                connection.send({ message_type: "committed_transcript", text: "book a table for two" });
            });

            expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual([
                "partial",
                "final",
                "turn_end",
            ]);
            expect(events.map((event) => event.type === "transcript" && event.delta)).toEqual([
                "book a",
                " table",
                " for two",
            ]);
        });

        it("starts a new turn after a commit", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ message_type: "committed_transcript", text: "first" });
                connection.send({ message_type: "partial_transcript", text: "second" });
            });

            expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
            expect(events[1]).toMatchObject({ text: "second", delta: "second" });
        });

        // With timestamps on, the *_with_timestamps variants carry the same
        // text plus words, so taking both would emit every turn twice.
        it("takes the plain variants when timestamps are off", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ message_type: "final_transcript", text: "hello" });
                connection.send({ message_type: "final_transcript_with_timestamps", text: "hello", words: [] });
                connection.send({ message_type: "committed_transcript", text: "hello there" });
                connection.send({ message_type: "committed_transcript_with_timestamps", text: "hello there" });
            });

            expect(events).toHaveLength(2);
            expect(events.map((event) => event.type === "transcript" && event.finality)).toEqual(["final", "turn_end"]);
        });

        it("takes the timestamped variants when timestamps are on", async () => {
            const events = await eventsFrom({ timestamps: true }, (connection) => {
                connection.send({ message_type: "final_transcript", text: "hello" });
                connection.send({
                    message_type: "final_transcript_with_timestamps",
                    text: "hello",
                    language_code: "en",
                    words: [{ text: "hello", start: 0.1, end: 0.6, type: "word", logprob: 0, speaker_id: "speaker_0" }],
                });
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                finality: "final",
                language: "en",
                words: [{ text: "hello", start: 0.1, end: 0.6, confidence: 1, speaker: "speaker_0", kind: "word" }],
            });
        });

        it("fails the stream on an error message", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            connection.send({ message_type: "error", message: "audio format not supported" });

            await expect(collect(session.output)).rejects.toThrow(/audio format not supported/);
        });

        it("fails the stream on a frame that is not JSON", async () => {
            const session = await provider().openSTTSession();
            const connection = await server.connection();

            connection.send("<html>");

            await expect(collect(session.output)).rejects.toThrow(/invalid JSON/);
        });

        it("ignores message types core has no equivalent for", async () => {
            const events = await eventsFrom({}, (connection) => {
                connection.send({ message_type: "vad_score", score: 0.4 });
            });

            expect(events).toEqual([]);
        });
    });

    // No server-side discard exists, so this only drops the local turn.
    it("drops the in-progress turn on cancel", async () => {
        const session = await provider().openSTTSession();
        const connection = await server.connection();

        connection.send({ message_type: "partial_transcript", text: "half a sen" });
        await new Promise((resolve) => setTimeout(resolve, 20));
        session.cancel();
        connection.send({ message_type: "partial_transcript", text: "starting over" });
        connection.close();

        const events = await collect(session.output);

        expect(events.map((event) => event.type === "transcript" && event.turn)).toEqual([0, 1]);
        expect(events[1]).toMatchObject({ text: "starting over", delta: "starting over" });
    });
});
