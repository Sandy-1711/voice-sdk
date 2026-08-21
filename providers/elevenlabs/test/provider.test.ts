import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCapabilityInvariants, fakeHttp, type FakeHttp } from "@voice-sdk/test-kit";
import { ElevenLabsProvider } from "../src/index";

let server: FakeHttp;

beforeEach(async () => {
    server = await fakeHttp({
        "GET /v1/voices": {
            body: {
                voices: [
                    {
                        voice_id: "voice-1",
                        name: "Rachel",
                        labels: { accent: "american", age: "young" },
                        preview_url: "https://audio.test/rachel.mp3",
                    },
                    { voice_id: "voice-2", name: "Adam" },
                ],
            },
        },
    });
});

afterEach(async () => {
    await server.close();
});

describe("ElevenLabsProvider", () => {
    it("keeps the promise its capability flags make", () => {
        expect(() => assertCapabilityInvariants(new ElevenLabsProvider({ apiKey: "k" }))).not.toThrow();
    });

    it("reports the four capabilities it implements", () => {
        expect(new ElevenLabsProvider({ apiKey: "k" }).capabilities).toEqual({
            tts: true,
            stt: true,
            realtimeTTS: true,
            realtimeSTT: true,
        });
    });

    it("names itself the way its errors do", () => {
        expect(new ElevenLabsProvider({ apiKey: "k" }).name).toBe("elevenlabs");
    });

    describe("listVoices", () => {
        it("maps the catalogue onto core's shape", async () => {
            const voices = await new ElevenLabsProvider({
                apiKey: "k",
                baseUrl: server.baseUrl,
            }).listVoices();

            expect(voices).toEqual([
                {
                    id: "voice-1",
                    name: "Rachel",
                    labels: { accent: "american", age: "young" },
                    previewUrl: "https://audio.test/rachel.mp3",
                },
                { id: "voice-2", name: "Adam", labels: undefined, previewUrl: undefined },
            ]);
            expect(server.last().headers["xi-api-key"]).toBe("k");
        });
    });
});
