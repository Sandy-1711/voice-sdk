import { ConfigError, createTransport } from "@swungstudent/voice";
import type { AudioFormat, HttpHandler, HttpMiddleware, Logger, RateLimitOptions } from "@swungstudent/voice";

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
    /** The assembled middleware chain every HTTP call goes through. */
    transport: HttpHandler;
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
