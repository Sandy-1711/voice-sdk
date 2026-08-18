import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoiceError } from "@swungstudent/voice";
import { fakeSocket, waitFor, type FakeSocket } from "@voice-sdk/test-kit";
import { handshake, open, sendWhenOpen, toBytes } from "../src/internal/socket";

let server: FakeSocket;

beforeEach(async () => {
    server = await fakeSocket();
});

afterEach(async () => {
    await server.close();
});

describe("open", () => {
    it("upgrades the scheme and carries the token", async () => {
        const ws = open(new URL(`${server.baseUrl}/v1/listen?model=nova-3`), "secret");
        await handshake(ws, "STT");

        const connection = await server.connection();
        expect(connection.headers.authorization).toBe("Token secret");
        expect(connection.url.pathname).toBe("/v1/listen");
        expect(connection.url.searchParams.get("model")).toBe("nova-3");

        ws.close();
    });

    it("maps https to wss, so a real host is never contacted in the clear", () => {
        // Port 1 on loopback: the scheme is the whole point, and nothing is
        // listening, so the suite stays offline.
        const ws = open(new URL("https://127.0.0.1:1/v1/listen"), "k");
        ws.on("error", () => {
            /* the connection is expected to fail; only the scheme matters */
        });

        expect(ws.url.startsWith("wss://")).toBe(true);
        ws.terminate();
    });
});

describe("sendWhenOpen", () => {
    // push() is fire-and-forget, so it must not have to be awaited - anything
    // sent during the handshake has to be queued rather than dropped.
    it("queues what is sent before the handshake completes", async () => {
        const ws = open(new URL(`${server.baseUrl}/v1/listen`), "k");

        sendWhenOpen(ws, JSON.stringify({ type: "KeepAlive" }));
        await handshake(ws, "STT");

        const connection = await server.connection();
        expect(await connection.nextJson()).toEqual({ type: "KeepAlive" });

        ws.close();
    });

    it("sends straight away once the socket is open", async () => {
        const ws = open(new URL(`${server.baseUrl}/v1/listen`), "k");
        await handshake(ws, "STT");
        const connection = await server.connection();

        sendWhenOpen(ws, JSON.stringify({ type: "Finalize" }));

        expect(await connection.nextJson()).toEqual({ type: "Finalize" });
        ws.close();
    });

    it("drops what is sent after the socket is gone, rather than throwing", async () => {
        const ws = open(new URL(`${server.baseUrl}/v1/listen`), "k");
        await handshake(ws, "STT");
        ws.close();
        await waitFor(() => ws.readyState === ws.CLOSED, 2000, "the socket to close");

        expect(() => sendWhenOpen(ws, "late")).not.toThrow();
    });
});

describe("handshake", () => {
    // Waiting for the handshake is what makes a bad key or model throw from
    // open() rather than silently ending the caller's for-await later.
    it("rejects with a VoiceError naming the socket that failed", async () => {
        const port = new URL(server.baseUrl).port;
        await server.close();

        const ws = open(new URL(`http://127.0.0.1:${port}/v1/listen`), "k");

        await expect(handshake(ws, "TTS")).rejects.toBeInstanceOf(VoiceError);
        server = await fakeSocket();
    });

    it("resolves once the socket is usable", async () => {
        const ws = open(new URL(`${server.baseUrl}/v1/speak`), "k");

        await expect(handshake(ws, "TTS")).resolves.toBeUndefined();
        ws.close();
    });
});

describe("toBytes", () => {
    it("handles every shape ws hands back", () => {
        const buffer = Buffer.from([1, 2, 3]);

        expect(Uint8Array.from(toBytes(buffer))).toEqual(new Uint8Array([1, 2, 3]));
        expect(Uint8Array.from(toBytes([Buffer.from([1]), Buffer.from([2])]))).toEqual(new Uint8Array([1, 2]));
        expect(Uint8Array.from(toBytes(new Uint8Array([4, 5]).buffer))).toEqual(new Uint8Array([4, 5]));
    });

    it("views a slice of a pooled buffer without copying its neighbours", () => {
        const pool = Buffer.from([9, 1, 2, 9]);

        expect(toBytes(pool.subarray(1, 3))).toEqual(new Uint8Array([1, 2]));
    });
});
