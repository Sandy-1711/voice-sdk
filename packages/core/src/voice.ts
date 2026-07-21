import { VoiceProvider } from './provider';


interface VoiceOptions {
    timeout?: number;
    retries?: number;
    // TODO: Add a proper logger type here, for now we will use any
    logger?: any;
}

interface VoiceConfig<
    TProvider extends VoiceProvider,
    options extends VoiceOptions
> {
    provider: TProvider;
    options?: options;
}


export class Voice<
    TProvider extends VoiceProvider,
    options extends VoiceOptions = VoiceOptions
> {
    #provider: TProvider;
    #options: options | undefined;
    constructor(config: VoiceConfig<TProvider, options>) {
        this.#provider = config.provider;
        this.#options = config.options;

        // Initialize the provider
        this.#provider.init?.();
    }
    get tts(): TProvider['tts'] {
        return this.#provider.tts;
    }
    get stt(): TProvider['stt'] {
        return this.#provider.stt;
    }
    get cloning(): TProvider['cloning'] {
        return this.#provider.cloning;
    }
    get provider(): TProvider {
        return this.#provider;
    }

    async speak(text: string): Promise<void> {
        if (!this.#provider.tts) {
            throw new Error(`Provider "${this.#provider.name}" does not support TTS.`);
        }
    }

}