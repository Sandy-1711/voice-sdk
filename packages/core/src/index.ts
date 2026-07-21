import { VoiceProvider } from './provider';


interface VoiceConfig<TProvider extends VoiceProvider> {
    provider: TProvider;
}


export class Voice<
    TProvider extends VoiceProvider
> {
    #provider: TProvider;
    constructor(config: VoiceConfig<TProvider>) {
        this.#provider = config.provider;
    }
}