import type { VoiceProvider, VoiceInfo } from "./provider";
import { CapabilityError } from "./errors";
import type { AudioStream } from "./audio";
import type { Logger } from "./logger";
import type { RealtimeSTTInput, RealtimeTTSInput, STTSession, TTSSession } from "./realtime";
import type { RequestContext, SpeakInput, SpeakResult, TranscribeInput, TranscriptResult } from "./types";

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

    /** Opens a session that takes pushed text and streams audio back. */
    async openTTSSession(input?: RealtimeTTSInput): Promise<TTSSession> {
        if (!this.#provider.openTTSSession) {
            throw new CapabilityError(this.#provider.name, "openTTSSession");
        }
        return this.#provider.openTTSSession(input);
    }

    /** Opens a session that takes pushed audio and streams transcripts back. */
    async openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        if (!this.#provider.openSTTSession) {
            throw new CapabilityError(this.#provider.name, "openSTTSession");
        }
        return this.#provider.openSTTSession(input);
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
