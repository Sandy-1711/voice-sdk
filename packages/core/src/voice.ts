import type { VoiceProvider, VoiceInfo } from "./provider";
import { CapabilityError } from "./errors";
import type { AudioStream } from "./audio";
import type { Logger } from "./logger";
import {
    chain,
    chainListVoices,
    logOperations,
    type OperationCall,
    type VoiceMiddleware,
} from "./middleware";
import type { RealtimeSTTInput, RealtimeTTSInput, STTSession, TTSSession } from "./realtime";
import type { RequestContext, SpeakInput, SpeakResult, TranscribeInput, TranscriptResult } from "./types";

export interface VoiceOptions {
    /** Per-request timeout in milliseconds. */
    timeout?: number;
    /** Number of retry attempts for retryable failures. */
    retries?: number;
    /** Supplying one adds the built-in operation logger. */
    logger?: Logger;
}

export interface VoiceConfig<TProvider extends VoiceProvider> {
    provider: TProvider;
    options?: VoiceOptions;
    /**
     * Operation-level hooks — logging, metrics, tracing. The first entry is
     * outermost. Retry and deadlines belong to the provider's transport, not
     * here; see docs/middleware.md.
     */
    middleware?: VoiceMiddleware[];
}

/**
 * The unified entry point. Wraps a provider and exposes a consistent surface
 * across all providers.
 */
export class Voice<TProvider extends VoiceProvider> {
    #provider: TProvider;
    #options: VoiceOptions;
    #middleware: VoiceMiddleware[];

    constructor(config: VoiceConfig<TProvider>) {
        this.#provider = config.provider;
        this.#options = config.options ?? {};
        this.#middleware = [
            ...(config.middleware ?? []),
            // Innermost, so the duration it reports is the provider's own and
            // not the caller's middleware overhead.
            ...(this.#options.logger ? [logOperations(this.#options.logger)] : []),
        ];
    }

    get provider(): TProvider {
        return this.#provider;
    }

    get options(): Readonly<VoiceOptions> {
        return this.#options;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const speak = this.#provider.speak?.bind(this.#provider);
        if (!speak) throw new CapabilityError(this.#provider.name, "speak");

        const resolved = this.#context(context);
        return chain(
            this.#middleware,
            (entry) => entry.speak?.bind(entry),
            this.#call("speak", resolved),
            (next) => speak(next, resolved),
        )(input);
    }

    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        const speakStream = this.#provider.speakStream?.bind(this.#provider);
        if (!speakStream) throw new CapabilityError(this.#provider.name, "speakStream");

        const resolved = this.#context(context);
        return chain(
            this.#middleware,
            (entry) => entry.speakStream?.bind(entry),
            this.#call("speakStream", resolved),
            (next) => speakStream(next, resolved),
        )(input);
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        const transcribe = this.#provider.transcribe?.bind(this.#provider);
        if (!transcribe) throw new CapabilityError(this.#provider.name, "transcribe");

        const resolved = this.#context(context);
        return chain(
            this.#middleware,
            (entry) => entry.transcribe?.bind(entry),
            this.#call("transcribe", resolved),
            (next) => transcribe(next, resolved),
        )(input);
    }

    /** Opens a session that takes pushed text and streams audio back. */
    async openTTSSession(input?: RealtimeTTSInput): Promise<TTSSession> {
        const open = this.#provider.openTTSSession?.bind(this.#provider);
        if (!open) throw new CapabilityError(this.#provider.name, "openTTSSession");

        return chain(
            this.#middleware,
            (entry) => entry.openTTSSession?.bind(entry),
            this.#call("openTTSSession"),
            (next) => open(next),
        )(input);
    }

    /** Opens a session that takes pushed audio and streams transcripts back. */
    async openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        const open = this.#provider.openSTTSession?.bind(this.#provider);
        if (!open) throw new CapabilityError(this.#provider.name, "openSTTSession");

        return chain(
            this.#middleware,
            (entry) => entry.openSTTSession?.bind(entry),
            this.#call("openSTTSession"),
            (next) => open(next),
        )(input);
    }

    async listVoices(): Promise<VoiceInfo[]> {
        const listVoices = this.#provider.listVoices?.bind(this.#provider);
        if (!listVoices) throw new CapabilityError(this.#provider.name, "listVoices");

        return chainListVoices(this.#middleware, this.#call("listVoices"), () => listVoices())();
    }

    async close(): Promise<void> {
        await this.#provider.close?.();
    }

    #call(operation: OperationCall["operation"], context?: RequestContext): OperationCall {
        return { provider: this.#provider.name, operation, context };
    }

    /** Per-call context wins over the defaults given to the constructor. */
    #context(context?: RequestContext): RequestContext {
        return {
            timeout: this.#options.timeout,
            retries: this.#options.retries,
            ...context,
        };
    }
}
