import { ConfigError } from "@voice-sdk/core";
import type { AudioFormat } from "@voice-sdk/core";

/** Single source of truth for the name this provider reports in errors. */
export const PROVIDER = "elevenlabs";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export interface ElevenLabsConfig {
    /** Falls back to the `ELEVENLABS_API_KEY` env var. */
    apiKey?: string;
    /** Residency host, e.g. https://api.eu.residency.elevenlabs.io */
    baseUrl?: string;
    /** ElevenLabs puts the voice id in the URL path, so TTS needs one. */
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    defaultRealtimeSTTModel?: string;
    defaultFormat?: AudioFormat;
}

/** Pinned, never `-latest`, so generated audio does not shift under callers. */
export const DEFAULTS = {
    ttsModel: "eleven_multilingual_v2",
    sttModel: "scribe_v2",
    realtimeSTTModel: "scribe_v2_realtime",
} as const;

export interface ResolvedConfig {
    apiKey: string;
    baseUrl?: string;
    /** Stays optional: TTS throws naming `voice` if no call supplies one. */
    defaultVoice?: string;
    defaultModel: string;
    defaultSTTModel: string;
    defaultRealtimeSTTModel: string;
    defaultFormat?: AudioFormat;
}

export function resolveConfig(config: ElevenLabsConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new ConfigError(
            PROVIDER,
            "apiKey",
            "Pass `apiKey` or set the ELEVENLABS_API_KEY environment variable.",
        );
    }

    return {
        apiKey,
        baseUrl: config.baseUrl,
        defaultVoice: config.defaultVoice,
        defaultModel: config.defaultModel ?? DEFAULTS.ttsModel,
        defaultSTTModel: config.defaultSTTModel ?? DEFAULTS.sttModel,
        defaultRealtimeSTTModel: config.defaultRealtimeSTTModel ?? DEFAULTS.realtimeSTTModel,
        defaultFormat: config.defaultFormat,
    };
}
