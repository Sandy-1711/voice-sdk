import type { VoiceProvider } from "./provider";
import { CapabilityError } from "./errors";
import type { TranscribeInput, SynthesizeInput, SynthesizeOutput, Transcription, AudioChunk, Transcript, StreamingSynthesisInput, StreamingTranscriptionInput } from "./types";

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

    async transcribe(input: TranscribeInput): Promise<Transcription> {
        if (!this.#provider.transcribe) {
            throw new CapabilityError(this.#provider.name, "transcribe");
        }
        return this.#provider.transcribe(input);
    }

    async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
        if (!this.#provider.synthesize) {
            throw new CapabilityError(this.#provider.name, "synthesize");
        }
        return this.#provider.synthesize(input);
    }

    async *synthesizeStream(input: StreamingSynthesisInput): AsyncIterable<AudioChunk> {
        if (!this.#provider.synthesizeStream) {
            throw new CapabilityError(this.#provider.name, "realtime synthesis");
        }
        yield* this.#provider.synthesizeStream(input);
    }

    async *transcribeStream(input: StreamingTranscriptionInput): AsyncIterable<Transcript> {
        if (!this.#provider.transcribeStream) {
            throw new CapabilityError(this.#provider.name, "realtime transcription");
        }
        yield* this.#provider.transcribeStream(input);
    }

}
