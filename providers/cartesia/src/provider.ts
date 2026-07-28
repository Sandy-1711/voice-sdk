import { VoiceProvider } from "@voice-sdk/core";
import { Cartesia } from '@cartesia/cartesia-js';
import { ConfigError } from "@voice-sdk/core";
import type { SynthesizeInput, SynthesizeOutput, TranscribeInput, Transcription, Transcript, StreamingSynthesisInput, StreamingTranscriptionInput } from "@voice-sdk/core";
export interface CartesiaProviderConfig {
    apiKey?: string;
}

export class CartesiaProvider implements VoiceProvider {
    readonly name = "cartesia";
    readonly capabilities = {
        tts: true,
        stt: true,
        streamingTTS: false,
        streamingSTT: false,
    };
    #client: Cartesia;
    constructor(config: CartesiaProviderConfig = {}) {
        const apiKey = config.apiKey || process.env.CARTESIA_API_KEY;
        if (!apiKey) {
            throw new ConfigError("cartesia", "apiKey", "Cartesia API key is required. Please provide it in the config or set the CARTESIA_API_KEY environment variable.");
        }
        this.#client = new Cartesia({ apiKey: apiKey });
    }

    async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {

    }
    async transcribe(input: TranscribeInput): Promise<Transcription> {

    }
}