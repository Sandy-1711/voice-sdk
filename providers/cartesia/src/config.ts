import { ConfigError, createTransport } from "@swungstudent/voice";
import type {
    AudioFormat,
    HttpHandler,
    HttpMiddleware,
    Logger,
    RateLimitOptions,
    ResolvedAudioFormat,
} from "@swungstudent/voice";

/** Single source of truth for the name this provider reports in errors. */
export const PROVIDER = "cartesia";

export const DEFAULT_BASE_URL = "https://api.cartesia.ai";

/**
 * Pinned rather than tracking whatever the API defaults to, so a server-side
 * schema change cannot alter responses under callers. Sent on every request and
 * every socket handshake.
 */
export const CARTESIA_VERSION = "2025-11-04";

export interface CartesiaConfig {
    /** Falls back to the `CARTESIA_API_KEY` env var. */
    apiKey?: string;
    baseUrl?: string;
    /** Voice id used when a call does not specify one. */
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    /**
     * Realtime STT model used when a call does not name one. Unset, each
     * turn-detection mode falls back to its own default, since the two
     * endpoints do not accept the same models.
     */
    defaultRealtimeSTTModel?: string;
    defaultFormat?: AudioFormat;

    /** Extra attempts after a retryable failure. A per-call context wins. Default 2. */
    retries?: number;
    /** Milliseconds allowed for response headers. A per-call context wins. */
    timeout?: number;
    /** Supplying one turns request logging on. */
    logger?: Logger;
    /** Supplying one turns rate limiting on. */
    rateLimit?: RateLimitOptions;
    /** Extra HTTP middleware, applied outside the built-in chain. */
    middleware?: HttpMiddleware[];
    /** Innermost handler. Swappable so a test never has to reach the network. */
    fetch?: HttpHandler;
}

export interface ResolvedConfig {
    apiKey: string;
    baseUrl?: string;
    defaultVoice?: string;
    defaultModel: string;
    defaultSTTModel: string;
    /** Stays optional: each realtime mode has its own fallback. */
    defaultRealtimeSTTModel?: string;
    defaultFormat?: AudioFormat;
    /** The assembled middleware chain every HTTP call goes through. */
    transport: HttpHandler;
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

export function resolveConfig(config: CartesiaConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
    if (!apiKey) {
        throw new ConfigError(
            PROVIDER,
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
        defaultRealtimeSTTModel: config.defaultRealtimeSTTModel,
        defaultFormat: config.defaultFormat,
        transport: createTransport({
            provider: PROVIDER,
            retries: config.retries,
            timeout: config.timeout,
            logger: config.logger,
            rateLimit: config.rateLimit,
            middleware: config.middleware,
            fetch: config.fetch,
        }),
    };
}
