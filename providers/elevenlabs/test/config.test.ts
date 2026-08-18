import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@voice-sdk/core";
import { DEFAULTS, resolveConfig } from "../src/config";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("resolveConfig", () => {
    it("takes the key it was handed", () => {
        expect(resolveConfig({ apiKey: "explicit" }).apiKey).toBe("explicit");
    });

    it("falls back to ELEVENLABS_API_KEY", () => {
        vi.stubEnv("ELEVENLABS_API_KEY", "from-env");

        expect(resolveConfig({}).apiKey).toBe("from-env");
    });

    it("names the field and both ways to fix it when there is no key", () => {
        vi.stubEnv("ELEVENLABS_API_KEY", "");

        const thrown = catchError(() => resolveConfig({}));

        expect(thrown).toBeInstanceOf(ConfigError);
        expect(thrown).toMatchObject({ provider: "elevenlabs", field: "apiKey" });
        expect((thrown as Error).message).toContain("ELEVENLABS_API_KEY");
    });

    it("applies the pinned model defaults", () => {
        const config = resolveConfig({ apiKey: "k" });

        expect(config.defaultModel).toBe(DEFAULTS.ttsModel);
        expect(config.defaultSTTModel).toBe(DEFAULTS.sttModel);
        expect(config.defaultRealtimeSTTModel).toBe(DEFAULTS.realtimeSTTModel);
    });

    it("pins models rather than tracking -latest, so audio does not shift under callers", () => {
        for (const model of Object.values(DEFAULTS)) {
            expect(model).not.toContain("latest");
        }
    });

    it("lets a caller override each model independently", () => {
        const config = resolveConfig({ apiKey: "k", defaultModel: "eleven_flash_v2_5", defaultSTTModel: "scribe_v1" });

        expect(config.defaultModel).toBe("eleven_flash_v2_5");
        expect(config.defaultSTTModel).toBe("scribe_v1");
        expect(config.defaultRealtimeSTTModel).toBe(DEFAULTS.realtimeSTTModel);
    });

    // ElevenLabs puts the voice id in the URL path, but TTS is the only thing
    // that needs one - so resolution stays quiet and TTS throws by name later.
    it("leaves defaultVoice unset rather than inventing one", () => {
        expect(resolveConfig({ apiKey: "k" }).defaultVoice).toBeUndefined();
        expect(resolveConfig({ apiKey: "k", defaultVoice: "voice-1" }).defaultVoice).toBe("voice-1");
    });

    it("carries a residency host through", () => {
        expect(resolveConfig({ apiKey: "k", baseUrl: "https://api.eu.residency.elevenlabs.io" }).baseUrl).toBe(
            "https://api.eu.residency.elevenlabs.io",
        );
        expect(resolveConfig({ apiKey: "k" }).baseUrl).toBeUndefined();
    });
});

function catchError(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }
    throw new Error("Expected the call to throw, but it returned.");
}
