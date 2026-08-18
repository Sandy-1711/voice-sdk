import { ConfigError } from "@swungstudent/voice";
import type { AudioFormat, ResolvedAudioFormat } from "@swungstudent/voice";

/** Single source of truth for the name this provider reports in errors. */
export const PROVIDER = "deepgram";

export const DEFAULT_BASE_URL = "https://api.deepgram.com";

export interface DeepgramConfig {
    /** Falls back to the `DEEPGRAM_API_KEY` env var. */
    apiKey?: string;
    baseUrl?: string;
    /**
     * Deepgram has no separate voice parameter — a voice *is* a model
     * (`aura-2-thalia-en`), so this is just another way to spell `defaultModel`.
     */
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    defaultRealtimeSTTModel?: string;
    defaultFormat?: AudioFormat;
}

/** Pinned, never `-latest`, so generated audio does not shift under callers. */
export const DEFAULTS = {
    ttsModel: "aura-2-thalia-en",
    sttModel: "nova-3",
    realtimeSTTModel: "nova-3",
} as const;

export interface ResolvedConfig {
    apiKey: string;
    baseUrl?: string;
    /** `defaultVoice` is folded in here, since Deepgram has only one knob. */
    defaultModel: string;
    defaultSTTModel: string;
    defaultRealtimeSTTModel: string;
    defaultFormat?: AudioFormat;
}

/** Batch audio is usually written to a file, so it carries a header. */
export const DEFAULT_FORMAT: ResolvedAudioFormat = {
    container: "wav",
    encoding: "pcm_s16le",
    sampleRate: 24000,
    channels: 1,
};

/** Streamed audio goes to a speaker or a socket, where a header is noise. */
export const DEFAULT_STREAM_FORMAT: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 24000,
    channels: 1,
};

export function resolveConfig(config: DeepgramConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
        throw new ConfigError(
            PROVIDER,
            "apiKey",
            "Pass `apiKey` or set the DEEPGRAM_API_KEY environment variable.",
        );
    }

    return {
        apiKey,
        baseUrl: config.baseUrl,
        // A voice *is* a model here, so `defaultVoice` collapses into
        // `defaultModel` rather than being carried as a second knob.
        defaultModel: config.defaultModel ?? config.defaultVoice ?? DEFAULTS.ttsModel,
        defaultSTTModel: config.defaultSTTModel ?? DEFAULTS.sttModel,
        defaultRealtimeSTTModel: config.defaultRealtimeSTTModel ?? DEFAULTS.realtimeSTTModel,
        defaultFormat: config.defaultFormat,
    };
}
