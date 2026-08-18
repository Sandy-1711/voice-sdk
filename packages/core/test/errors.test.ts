import { describe, expect, it } from "vitest";
import { CapabilityError, ConfigError, ValidationError, VoiceError } from "../src/index";

describe("errors", () => {
    it("hangs every error off VoiceError, so one catch covers the SDK", () => {
        const errors = [
            new VoiceError("plain"),
            new CapabilityError("deepgram", "listVoices"),
            new ConfigError("deepgram", "apiKey", "missing"),
            new ValidationError("deepgram", "timestamps", "unsupported"),
        ];

        for (const error of errors) {
            expect(error).toBeInstanceOf(VoiceError);
            expect(error).toBeInstanceOf(Error);
        }
    });

    it("names each error after its class, so stack traces read properly", () => {
        expect(new VoiceError("x").name).toBe("VoiceError");
        expect(new CapabilityError("p", "c").name).toBe("CapabilityError");
        expect(new ConfigError("p", "f", "m").name).toBe("ConfigError");
        expect(new ValidationError("p", "f", "m").name).toBe("ValidationError");
    });

    it("says which provider lacks which capability", () => {
        const error = new CapabilityError("deepgram", "listVoices");

        expect(error.provider).toBe("deepgram");
        expect(error.capability).toBe("listVoices");
        expect(error.message).toBe(`Provider "deepgram" does not support "listVoices".`);
    });

    it("points a config failure at the field that caused it", () => {
        const error = new ConfigError("cartesia", "apiKey", "Pass `apiKey` or set CARTESIA_API_KEY.");

        expect(error.provider).toBe("cartesia");
        expect(error.field).toBe("apiKey");
        expect(error.message).toBe(
            'Provider "cartesia" configuration error for field "apiKey": Pass `apiKey` or set CARTESIA_API_KEY.',
        );
    });

    // Thrown before the request goes out, so the message has to name the field
    // rather than leave the caller with a bare 400 from the API.
    it("points a rejected request at the offending field", () => {
        const error = new ValidationError("elevenlabs", "timings", `only "character" is supported`);

        expect(error.provider).toBe("elevenlabs");
        expect(error.field).toBe("timings");
        expect(error.message).toBe(`Provider "elevenlabs" rejected "timings": only "character" is supported`);
    });
});
