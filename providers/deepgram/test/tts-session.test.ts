import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertTTSEvent, collect, fakeSocket, pcmRamp, type FakeSocket } from "@voice-sdk/test-kit";
import type { TTSEvent } from "@voice-sdk/core";
import { DeepgramProvider } from "../src/index";

let server: FakeSocket;

function provider(config = {}) {
    return new DeepgramProvider({ apiKey: "k", baseUrl: server.baseUrl, ...config });
}

beforeEach(async () => {
    server = await fakeSocket();
});

afterEach(async () => {
    await server.close();
});

describe("openTTSSession", () => {
    describe("handshake", () => {
        it("connects to the synthesis socket with the token and the mapped format", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            expect(connection.url.pathname).toBe("/v1/speak");
            expect(connection.headers.authorization).toBe("Token k");
            expect(connection.url.searchParams.get("model")).toBe("aura-2-thalia-en");
            expect(connection.url.searchParams.get("encoding")).toBe("linear16");
            expect(connection.url.searchParams.get("sample_rate")).toBe("24000");
            // The synthesis socket rejects a container param outright.
            expect(connection.url.searchParams.has("container")).toBe(false);

            expect(session.format).toEqual({
                container: "raw",
                encoding: "pcm_s16le",
                sampleRate: 24000,
                channels: 1,
            });
        });

        it("carries the voice, speed and providerOptions into the query", async () => {
            await provider().openTTSSession({
                voice: "aura-2-andromeda-en",
                controls: { speed: 1.2 },
                format: { encoding: "mulaw", sampleRate: 8000 },
                providerOptions: { mip_opt_out: true },
            });
            const connection = await server.connection();

            expect(connection.url.searchParams.get("model")).toBe("aura-2-andromeda-en");
            expect(connection.url.searchParams.get("speed")).toBe("1.2");
            expect(connection.url.searchParams.get("encoding")).toBe("mulaw");
            expect(connection.url.searchParams.get("mip_opt_out")).toBe("true");
        });

        it("refuses a framed container before opening a socket", async () => {
            await expect(provider().openTTSSession({ format: { container: "wav" } })).rejects.toMatchObject({
                field: "format.container",
            });

            expect(server.connections).toHaveLength(0);
        });

        it("refuses a request for timings before opening a socket", async () => {
            await expect(provider().openTTSSession({ timings: true })).rejects.toMatchObject({ field: "timings" });

            expect(server.connections).toHaveLength(0);
        });
    });

    describe("sending", () => {
        it("sends each push as a Speak message", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            session.push("Hello ");
            session.push("there.");

            expect(await connection.nextJson()).toEqual({ type: "Speak", text: "Hello " });
            expect(await connection.nextJson()).toEqual({ type: "Speak", text: "there." });
        });

        it("asks for synthesis on flush", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            session.push("hi");
            await session.flush();

            await connection.nextJson();
            expect(await connection.nextJson()).toEqual({ type: "Flush" });
        });

        // Deepgram has a real barge-in, so cancel drops server-side audio
        // rather than faking it by dropping the connection.
        it("clears queued audio on cancel, keeping the socket open", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            session.cancel();

            expect(await connection.nextJson()).toEqual({ type: "Clear" });
            expect(server.connections).toHaveLength(1);
        });

        it("says goodbye on close and waits for the socket to go", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            const closing = session.close();
            expect(await connection.nextJson()).toEqual({ type: "Close" });
            connection.close();

            await expect(closing).resolves.toBeUndefined();
            await expect(session.closed).resolves.toBeUndefined();
        });
    });

    describe("receiving", () => {
        async function eventsFrom(script: (connection: Awaited<ReturnType<FakeSocket["connection"]>>) => void) {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            script(connection);
            connection.close();

            const events = await collect(session.output);
            for (const event of events) assertTTSEvent(event);
            return events;
        }

        it("turns binary frames into audio events", async () => {
            const audio = pcmRamp(16);

            const events = await eventsFrom((connection) => {
                connection.send(audio.subarray(0, 16));
                connection.send(audio.subarray(16));
            });

            expect(events.filter((event) => event.type === "audio")).toHaveLength(2);
            const bytes = Buffer.concat(
                events.flatMap((event) => (event.type === "audio" ? [Buffer.from(event.data)] : [])),
            );
            expect(bytes).toEqual(Buffer.from(audio));
        });

        it("reports the request id and model as metadata", async () => {
            const events = await eventsFrom((connection) => {
                connection.send({ type: "Metadata", request_id: "req-9", model_name: "aura-2-thalia-en" });
            });

            expect(events[0]).toMatchObject({ type: "metadata", requestId: "req-9", model: "aura-2-thalia-en" });
        });

        // Deepgram has no separate "generation complete" event, so Flushed has
        // to stand in for it or consumers waiting on `done` hang forever.
        it("synthesizes done after a Flushed, so consumers can wait on it", async () => {
            const events = await eventsFrom((connection) => {
                connection.send({ type: "Flushed", sequence_id: 3 });
            });

            expect(events.map((event) => event.type)).toEqual(["flushed", "done"]);
            expect(events[0]).toMatchObject({ id: 3 });
        });

        it("reports a Cleared as the barge-in landing", async () => {
            const events = await eventsFrom((connection) => connection.send({ type: "Cleared", sequence_id: 1 }));

            expect(events[0]).toEqual({ type: "cleared", id: 1 });
        });

        it("passes a warning through without ending the stream", async () => {
            const events = await eventsFrom((connection) => {
                connection.send({ type: "Warning", description: "text was truncated", code: "TRUNCATED" });
                connection.send({ type: "Flushed" });
            });

            expect(events[0]).toEqual({ type: "warning", message: "text was truncated", code: "TRUNCATED" });
            expect(events.map((event) => event.type)).toContain("done");
        });

        it("ignores message types core has no equivalent for", async () => {
            const events = await eventsFrom((connection) => connection.send({ type: "Nonsense" }));

            expect(events).toEqual([]);
        });

        it("fails the stream on an Error message", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            connection.send({ type: "Error", code: "RATE_LIMIT", description: "too many requests" });

            await expect(collect(session.output)).rejects.toThrow(/RATE_LIMIT: too many requests/);
        });

        it("fails the stream on a frame that is not JSON", async () => {
            const session = await provider().openTTSSession();
            const connection = await server.connection();

            connection.send("not json at all");

            await expect(collect(session.output)).rejects.toThrow(/invalid JSON/);
        });
    });

    it("closes the session when the caller's signal aborts", async () => {
        const controller = new AbortController();
        const session = await provider().openTTSSession({ signal: controller.signal });
        const connection = await server.connection();

        controller.abort();

        expect(await connection.nextJson()).toEqual({ type: "Close" });
        connection.close();
        await expect(session.closed).resolves.toBeUndefined();
    });

    it("ends the output stream when the far side hangs up", async () => {
        const session = await provider().openTTSSession();
        const connection = await server.connection();

        connection.close();

        await expect(collect(session.output)).resolves.toEqual([] as TTSEvent[]);
        await expect(session.closed).resolves.toBeUndefined();
    });
});
