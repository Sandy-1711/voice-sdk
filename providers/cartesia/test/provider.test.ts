import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCapabilityInvariants, fakeHttp, type FakeHttp } from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

let server: FakeHttp;

beforeEach(async () => {
    server = await fakeHttp({
        // The catalogue is a cursor-paginated list, so the second page has to
        // come back empty or the walk never ends.
        "GET /voices": [
            {
                body: {
                    data: [
                        {
                            id: "voice-1",
                            name: "Barbershop Man",
                            language: "en",
                            description: "A warm baritone",
                        },
                        { id: "voice-2", name: "Sarah", language: "en" },
                    ],
                    has_more: true,
                },
            },
            { body: { data: [], has_more: false } },
        ],
    });
});

afterEach(async () => {
    await server.close();
});

describe("CartesiaProvider", () => {
    it("keeps the promise its capability flags make", () => {
        expect(() => assertCapabilityInvariants(new CartesiaProvider({ apiKey: "k" }))).not.toThrow();
    });

    it("reports the four capabilities it implements", () => {
        expect(new CartesiaProvider({ apiKey: "k" }).capabilities).toEqual({
            tts: true,
            stt: true,
            realtimeTTS: true,
            realtimeSTT: true,
        });
    });

    it("names itself the way its errors do", () => {
        expect(new CartesiaProvider({ apiKey: "k" }).name).toBe("cartesia");
    });

    it("supplies the global WebSocket the SDK needs on node 18 and 20", () => {
        const original = globalThis.WebSocket;
        // Node 22 has one and older versions do not. Without this, the SDK
        // throws "requires the ws package" the moment a session opens.
        delete (globalThis as { WebSocket?: unknown }).WebSocket;

        try {
            new CartesiaProvider({ apiKey: "k" });
            expect(globalThis.WebSocket).toBeDefined();
        } finally {
            globalThis.WebSocket = original;
        }
    });

    it("leaves a WebSocket the runtime already provides alone", () => {
        const original = globalThis.WebSocket;
        new CartesiaProvider({ apiKey: "k" });

        expect(globalThis.WebSocket).toBe(original);
    });

    describe("listVoices", () => {
        it("walks the paginated catalogue onto core's shape", async () => {
            const voices = await new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl }).listVoices();

            expect(voices).toEqual([
                {
                    id: "voice-1",
                    name: "Barbershop Man",
                    language: "en",
                    labels: { description: "A warm baritone" },
                },
                { id: "voice-2", name: "Sarah", language: "en", labels: undefined },
            ]);
            expect(server.last().path).toBe("/voices");
        });
    });
});
