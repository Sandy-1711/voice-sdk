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

    it("falls back to DEEPGRAM_API_KEY", () => {
        vi.stubEnv("DEEPGRAM_API_KEY", "from-env");

        expect(resolveConfig({}).apiKey).toBe("from-env");
    });

    it("prefers an explicit key over the environment", () => {
        vi.stubEnv("DEEPGRAM_API_KEY", "from-env");

        expect(resolveConfig({ apiKey: "explicit" }).apiKey).toBe("explicit");
    });

    it("names the field and both ways to fix it when there is no key", () => {
        vi.stubEnv("DEEPGRAM_API_KEY", "");

        const thrown = catchError(() => resolveConfig({}));

        expect(thrown).toBeInstanceOf(ConfigError);
        expect(thrown).toMatchObject({ provider: "deepgram", field: "apiKey" });
        expect((thrown as Error).message).toContain("DEEPGRAM_API_KEY");
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

    // A Deepgram voice *is* a model, so defaultVoice is a second spelling of
    // defaultModel rather than a knob of its own.
    it("folds defaultVoice into defaultModel", () => {
        expect(resolveConfig({ apiKey: "k", defaultVoice: "aura-2-andromeda-en" }).defaultModel).toBe(
            "aura-2-andromeda-en",
        );
    });

    it("lets defaultModel win when a caller sets both", () => {
        const config = resolveConfig({ apiKey: "k", defaultVoice: "aura-2-andromeda-en", defaultModel: "aura-2-thalia-en" });

        expect(config.defaultModel).toBe("aura-2-thalia-en");
    });

    it("carries the rest through untouched", () => {
        const format = { container: "wav", sampleRate: 16000 } as const;
        const config = resolveConfig({ apiKey: "k", baseUrl: "https://self-hosted.test", defaultFormat: format });

        expect(config.baseUrl).toBe("https://self-hosted.test");
        expect(config.defaultFormat).toBe(format);
    });

    it("leaves baseUrl unset when there is none, so the default host applies", () => {
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
