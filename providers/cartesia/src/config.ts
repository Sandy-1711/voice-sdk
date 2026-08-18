import { ConfigError, type AudioFormat, type ResolvedAudioFormat } from "@swungstudent/voice";

export const PROVIDER = "cartesia";

export interface CartesiaConfig {
    /** Falls back to the `CARTESIA_API_KEY` env var. */
    apiKey?: string;
    baseUrl?: string;
    /** Voice id used when a call does not specify one. */
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    defaultFormat?: AudioFormat;
}

export interface ResolvedConfig {
    apiKey: string;
    baseUrl?: string;
    defaultVoice?: string;
    defaultModel: string;
    defaultSTTModel: string;
    defaultFormat?: AudioFormat;
}

export const DEFAULTS = {
    ttsModel: "sonic-3.5",
    sttModel: "ink-whisper",
    /** Realtime STT model per turn-detection mode. */
    manualSTTModel: "ink-whisper",
    vadSTTModel: "ink-2",
} as const;

/** Batch audio is usually written to a file, so it carries a header. */
export const DEFAULT_FORMAT: ResolvedAudioFormat = {
    container: "wav",
    encoding: "pcm_s16le",
    sampleRate: 44100,
    channels: 1,
};

/** Streamed audio goes to a speaker or a socket, where a header is noise. */
export const DEFAULT_STREAM_FORMAT: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 44100,
    channels: 1,
};

/** The one input format every realtime provider accepts. */
export const DEFAULT_INPUT_FORMAT: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
};

export function resolveConfig(config: CartesiaConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
    if (!apiKey) {
        throw new ConfigError(
            "cartesia",
            "apiKey",
            "Pass `apiKey` or set the CARTESIA_API_KEY environment variable.",
        );
    }

    return {
        apiKey,
        baseUrl: config.baseUrl,
        defaultVoice: config.defaultVoice,
        defaultModel: config.defaultModel ?? DEFAULTS.ttsModel,
        defaultSTTModel: config.defaultSTTModel ?? DEFAULTS.sttModel,
        defaultFormat: config.defaultFormat,
    };
}
