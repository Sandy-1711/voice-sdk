import { describe, expect, it } from "vitest";
import { CapabilityError, Voice } from "@swungstudent/voice";
import { assertCapabilityInvariants } from "@voice-sdk/test-kit";
import { DeepgramProvider } from "../src/index";

describe("DeepgramProvider", () => {
    it("keeps the promise its capability flags make", () => {
        expect(() => assertCapabilityInvariants(new DeepgramProvider({ apiKey: "k" }))).not.toThrow();
    });

    it("reports the four capabilities it implements", () => {
        expect(new DeepgramProvider({ apiKey: "k" }).capabilities).toEqual({
            tts: true,
            stt: true,
            realtimeTTS: true,
            realtimeSTT: true,
        });
    });

    it("names itself the way its errors do", () => {
        expect(new DeepgramProvider({ apiKey: "k" }).name).toBe("deepgram");
    });

    // Deepgram has no voice-listing endpoint, because a voice is a model - so
    // the method is absent rather than faked, and Voice says so.
    it("refuses listVoices through Voice, naming the provider", async () => {
        const voice = new Voice({ provider: new DeepgramProvider({ apiKey: "k" }) });

        await expect(voice.listVoices()).rejects.toBeInstanceOf(CapabilityError);
        await expect(voice.listVoices()).rejects.toMatchObject({
            provider: "deepgram",
            capability: "listVoices",
        });
    });
});
