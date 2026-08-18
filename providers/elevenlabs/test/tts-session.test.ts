import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@swungstudent/voice";
import { assertTTSEvent, collect, fakeSocket, pcmRamp, type FakeSocket } from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new ElevenLabsProvider({ apiKey: "k", defaultVoice: "voice-1", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeSocket();
});

afterEach(async () => {
    await server.close();
});

describe("openTTSSession", () => {
    describe("handshake", () => {
        // The socket opens lazily, which is what makes cancel() work: there is
        // no cancel command, so dropping the connection is the only way to stop
        // queued audio - and the next push transparently opens a new one.
        it("opens no socket until the first push", async () => {
            const session = await provider().openTTSSession();

            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(server.connections).toHaveLength(0);

            session.push("hello");
            await server.connection();
            expect(server.connections).toHaveLength(1);
        });

        it("puts the voice in the path and the rest in the query", async () => {
            const session = await provider().openTTSSession({ model: "eleven_flash_v2_5", language: "es" });
            session.push("hola");

            const { url, headers } = await server.connection();

            expect(url.pathname).toBe("/v1/text-to-speech/voice-1/stream-input");
            expect(headers["xi-api-key"]).toBe("k");
            expect(url.searchParams.get("model_id")).toBe("eleven_flash_v2_5");
            expect(url.searchParams.get("output_format")).toBe("mp3_44100_128");
            expect(url.searchParams.get("language_code")).toBe("es");
        });

        it("escapes a voice id rather than letting it break the path", async () => {
            const session = await provider({ defaultVoice: "voice/../admin" }).openTTSSession();
            session.push("hi");

            expect((await server.connection()).url.pathname).toBe("/v1/text-to-speech/voice%2F..%2Fadmin/stream-input");
        });

        it("asks for alignment only when the caller wants timings", async () => {
            const withTimings = await provider().openTTSSession({ timings: "character" });
            withTimings.push("hi");
            expect((await server.connection(0)).url.searchParams.get("sync_alignment")).toBe("true");

            const without = await provider().openTTSSession();
            without.push("hi");
            expect((await server.connection(1)).url.searchParams.has("sync_alignment")).toBe(false);
        });

        // A single space is ElevenLabs' begin-of-stream marker.
        it("sends the begin-of-stream marker with the voice settings", async () => {
            const session = await provider().openTTSSession({ controls: { speed: 1.1, stability: 0.5 } });
            session.push("hello");

            const connection = await server.connection();

            expect(await connection.nextJson()).toEqual({
                text: " ",
                voice_settings: { speed: 1.1, stability: 0.5 },
            });
        });

        it("lets providerOptions ride along on the handshake", async () => {
            const session = await provider().openTTSSession({ providerOptions: { chunk_length_schedule: [50] } });
            session.push("hello");

            expect(await (await server.connection()).nextJson()).toMatchObject({
                chunk_length_schedule: [50],
            });
        });

        it("refuses to open without a voice, naming the two ways to supply one", async () => {
            await expect(
                new ElevenLabsProvider({ apiKey: "k", baseUrl: server.baseUrl }).openTTSSession(),
            ).rejects.toMatchObject({ name: "ValidationError", field: "voice" });
        });

        it("refuses word timings, which ElevenLabs cannot report", async () => {
            await expect(provider().openTTSSession({ timings: "word" })).rejects.toMatchObject({ field: "timings" });
        });
    });

    describe("sending", () => {
        // ElevenLabs triggers generation on whitespace, so the trailing space
        // is load-bearing: without it the last word is held indefinitely.
        it("gives every push a trailing space", async () => {
            const session = await provider().openTTSSession();
            session.push("Hello");
            const connection = await server.connection();

            await connection.nextJson();
            expect(await connection.nextJson()).toEqual({ text: "Hello " });
        });

        it("does not double the space when the caller already sent one", async () => {
            const session = await provider().openTTSSession();
            session.push("Hello ");
            const connection = await server.connection();

            await connection.nextJson();
            expect(await connection.nextJson()).toEqual({ text: "Hello " });
        });

        it("asks for what is buffered to be synthesized on flush", async () => {
            const session = await provider().openTTSSession();
            session.push("hi");
            const connection = await server.connection();
            await connection.nextJson();
            await connection.nextJson();

            await session.flush();

            expect(await connection.nextJson()).toEqual({ text: "", flush: true });
        });

        it("has nothing to flush before the socket exists", async () => {
            const session = await provider().openTTSSession();

            await expect(session.flush()).resolves.toBeUndefined();
            expect(server.connections).toHaveLength(0);
        });

        it("ends the stream with an empty text on close", async () => {
            const session = await provider().openTTSSession();
            session.push("hi");
            const connection = await server.connection();

            const closing = session.close();
            await connection.nextMatching((message: { text?: string }) => message.text === "");
            connection.close();

            await expect(closing).resolves.toBeUndefined();
        });

        it("closes cleanly even if nothing was ever pushed", async () => {
            await expect((await provider().openTTSSession()).close()).resolves.toBeUndefined();
        });
    });

    describe("receiving", () => {
        it("decodes base64 audio frames", async () => {
            const audio = pcmRamp(8);
            const session = await provider().openTTSSession();
            session.push("hi");
            const connection = await server.connection();

            connection.send({ audio: encodeBase64(audio) });
            connection.send({ audio: encodeBase64(audio), isFinal: true });

            const events = await collect(session.output);
            for (const event of events) assertTTSEvent(event);

            expect(events.map((event) => event.type)).toEqual(["audio", "audio", "done"]);
            expect(events[0]).toMatchObject({ data: audio });
        });

        it("turns socket alignment into character spans", async () => {
            const session = await provider().openTTSSession({ timings: true });
            session.push("hi");
            const connection = await server.connection();

            connection.send({
                audio: encodeBase64(new Uint8Array([1])),
                alignment: { chars: ["h", "i"], charStartTimesMs: [0, 100], charDurationsMs: [100, 100] },
                isFinal: true,
            });

            const events = await collect(session.output);
            const timing = events.find((event) => event.type === "timing");

            expect(timing).toEqual({
                type: "timing",
                alignment: {
                    unit: "character",
                    spans: [
                        { text: "h", start: 0, end: 0.1 },
                        { text: "i", start: 0.1, end: 0.2 },
                    ],
                },
            });
        });

        it("falls back to the normalized alignment when that is all there is", async () => {
            const session = await provider().openTTSSession({ timings: true });
            session.push("hi");
            const connection = await server.connection();

            connection.send({
                normalizedAlignment: { chars: ["h"], charStartTimesMs: [0], charDurationsMs: [50] },
                isFinal: true,
            });

            const events = await collect(session.output);

            expect(events.find((event) => event.type === "timing")).toMatchObject({
                alignment: { spans: [{ text: "h", start: 0, end: 0.05 }] },
            });
        });

        it("fails the stream on a frame that is not JSON", async () => {
            const session = await provider().openTTSSession();
            session.push("hi");
            const connection = await server.connection();

            connection.send("<html>");

            await expect(collect(session.output)).rejects.toThrow(/invalid JSON/);
        });
    });

    // No cancel command exists, so the only way to stop queued audio is to drop
    // the socket - and the next push has to transparently open a new one.
    it("drops the connection on cancel and reconnects on the next push", async () => {
        const session = await provider().openTTSSession();
        session.push("first");
        const first = await server.connection(0);
        await first.nextJson();

        session.cancel();
        session.push("second");

        const second = await server.connection(1);
        expect(server.connections).toHaveLength(2);
        expect(await second.nextJson()).toMatchObject({ text: " " });
        expect(await second.nextJson()).toEqual({ text: "second " });
    });

    it("ends the output stream when the far side hangs up", async () => {
        const session = await provider().openTTSSession();
        session.push("hi");
        const connection = await server.connection();

        connection.close();

        await expect(collect(session.output)).resolves.toEqual([]);
        await expect(session.closed).resolves.toBeUndefined();
    });
});
