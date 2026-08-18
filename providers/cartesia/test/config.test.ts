import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@swungstudent/voice";
import { DEFAULTS, resolveConfig } from "../src/config";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("resolveConfig", () => {
    it("takes the key it was handed", () => {
        expect(resolveConfig({ apiKey: "explicit" }).apiKey).toBe("explicit");
    });

    it("falls back to CARTESIA_API_KEY", () => {
        vi.stubEnv("CARTESIA_API_KEY", "from-env");

        expect(resolveConfig({}).apiKey).toBe("from-env");
    });

    it("names the field and both ways to fix it when there is no key", () => {
        vi.stubEnv("CARTESIA_API_KEY", "");

        const thrown = catchError(() => resolveConfig({}));

        expect(thrown).toBeInstanceOf(ConfigError);
        expect(thrown).toMatchObject({ provider: "cartesia", field: "apiKey" });
        expect((thrown as Error).message).toContain("CARTESIA_API_KEY");
    });

    it("applies the pinned model defaults", () => {
        const config = resolveConfig({ apiKey: "k" });

        expect(config.defaultModel).toBe(DEFAULTS.ttsModel);
        expect(config.defaultSTTModel).toBe(DEFAULTS.sttModel);
    });

    it("pins models rather than tracking -latest, so audio does not shift under callers", () => {
        for (const model of Object.values(DEFAULTS)) {
            expect(model).not.toContain("latest");
        }
    });

    // Realtime STT picks its model by turn-detection mode, so the two defaults
    // have to stay distinct: ink-whisper has no turn detection at all.
    it("keeps a separate default for each realtime turn-detection mode", () => {
        expect(DEFAULTS.manualSTTModel).toBe("ink-whisper");
        expect(DEFAULTS.vadSTTModel).toBe("ink-2");
    });

    it("lets a caller override each model independently", () => {
        const config = resolveConfig({ apiKey: "k", defaultModel: "sonic-2", defaultSTTModel: "ink-2" });

        expect(config.defaultModel).toBe("sonic-2");
        expect(config.defaultSTTModel).toBe("ink-2");
    });

    it("carries the rest through untouched", () => {
        const format = { container: "wav", sampleRate: 24000 } as const;
        const config = resolveConfig({
            apiKey: "k",
            baseUrl: "https://self-hosted.test",
            defaultVoice: "voice-1",
            defaultFormat: format,
        });

        expect(config.baseUrl).toBe("https://self-hosted.test");
        expect(config.defaultVoice).toBe("voice-1");
        expect(config.defaultFormat).toBe(format);
    });

    it("leaves the voice unset rather than inventing one", () => {
        expect(resolveConfig({ apiKey: "k" }).defaultVoice).toBeUndefined();
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
