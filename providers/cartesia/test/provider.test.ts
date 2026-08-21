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

        // The cursor is this package's own now, not the SDK's pagination helper.
        it("asks for the next page starting after the last id it saw", async () => {
            await new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl }).listVoices();

            expect(server.requests).toHaveLength(2);
            expect(server.requests[0]?.query).toMatchObject({ limit: "100" });
            expect(server.requests[0]?.query).not.toHaveProperty("starting_after");
            expect(server.requests[1]?.query).toMatchObject({ starting_after: "voice-2" });
        });

        it("stops at a page that says there is no more", async () => {
            await server.close();
            server = await fakeHttp({
                "GET /voices": { body: { data: [{ id: "only" }], has_more: false } },
            });

            const voices = await new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl }).listVoices();

            expect(voices).toEqual([{ id: "only", name: undefined, language: undefined, labels: undefined }]);
            expect(server.requests).toHaveLength(1);
        });

        // A server that sets has_more and then runs dry must not loop forever.
        it("stops at an empty page even when the server still claims more", async () => {
            await server.close();
            server = await fakeHttp({ "GET /voices": { body: { data: [], has_more: true } } });

            await expect(
                new CartesiaProvider({ apiKey: "k", baseUrl: server.baseUrl }).listVoices(),
            ).resolves.toEqual([]);
            expect(server.requests).toHaveLength(1);
        });
    });
});
