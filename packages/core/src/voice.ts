import type { VoiceProvider, CapKey } from "./provider";
import type {
    SpeakInput,
    AudioResult,
    TTSSessionInput,
    TTSSession,
} from "./tts";
import type {
    TranscribeInput,
    Transcript,
    STTSessionInput,
    STTSession,
} from "./stt";
import { CapabilityError } from "./errors";


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

    get tts(): TProvider["tts"] {
        return this.#provider.tts;
    }
    get stt(): TProvider["stt"] {
        return this.#provider.stt;
    }
    get cloning(): TProvider["cloning"] {
        return this.#provider.cloning;
    }

    get provider(): TProvider {
        return this.#provider;
    }
    get options(): Readonly<VoiceOptions> {
        return this.#options;
    }


    #require<K extends CapKey>(cap: K): NonNullable<TProvider[K]> {
        const engine = this.#provider[cap];
        if (engine == null) {
            throw new CapabilityError(this.#provider.name, cap);
        }
        return engine as NonNullable<TProvider[K]>;
    }


    speak(input: SpeakInput): Promise<AudioResult> {
        return this.#require("tts").speak(input);
    }

    connect(input?: TTSSessionInput): TTSSession {
        return this.#require("tts").connect(input);
    }

    transcribe(input: TranscribeInput): Promise<Transcript> {
        return this.#require("stt").transcribe(input);
    }

    listen(input?: STTSessionInput): STTSession {
        return this.#require("stt").connect(input);
    }


    async init(): Promise<void> {
        await this.#provider.init?.();
    }

    async close(): Promise<void> {
        await this.#provider.close?.();
    }
}
