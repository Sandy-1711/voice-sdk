import { VoiceProvider } from "@voice-sdk/core";
import { Cartesia } from '@cartesia/cartesia-js';
export class CartesiaProvider implements VoiceProvider {
    readonly name = "cartesia";
    readonly capabilities = {
        tts: true,
        stt: true,
        streamingTTS: false,
        streamingSTT: false,
    };
    #client: Cartesia;
}