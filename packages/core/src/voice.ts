import type { VoiceProvider, VoiceInfo } from "./provider";
import { CapabilityError } from "./errors";
import type { AudioStream } from "./audio";
import type { RequestContext, SpeakInput, SpeakResult, TranscribeInput, TranscriptResult } from "./types";

export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export interface VoiceOptions {
    /** Per-request timeout in milliseconds. */
    timeout?: number;
    /** Number of retry attempts for retryable failures. */
    retries?: number;
    logger?: Logger;
}

export interface VoiceConfig<TProvider extends VoiceProvider> {
    provider: TProvider;
    options?: VoiceOptions;
}

/**
 * The unified entry point. Wraps a provider and exposes a consistent surface
 * across all providers.
 */
export class Voice<TProvider extends VoiceProvider> {
    #provider: TProvider;
    #options: VoiceOptions;

    constructor(config: VoiceConfig<TProvider>) {
        this.#provider = config.provider;
        this.#options = config.options ?? {};
    }

    get provider(): TProvider {
        return this.#provider;
    }

    get options(): Readonly<VoiceOptions> {
        return this.#options;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        if (!this.#provider.speak) {
            throw new CapabilityError(this.#provider.name, "speak");
        }
        return this.#provider.speak(input, this.#context(context));
    }

    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        if (!this.#provider.speakStream) {
            throw new CapabilityError(this.#provider.name, "speakStream");
        }
        return this.#provider.speakStream(input, this.#context(context));
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        if (!this.#provider.transcribe) {
            throw new CapabilityError(this.#provider.name, "transcribe");
        }
        return this.#provider.transcribe(input, this.#context(context));
    }

    async listVoices(): Promise<VoiceInfo[]> {
        if (!this.#provider.listVoices) {
            throw new CapabilityError(this.#provider.name, "listVoices");
        }
        return this.#provider.listVoices();
    }

    async close(): Promise<void> {
        await this.#provider.close?.();
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
