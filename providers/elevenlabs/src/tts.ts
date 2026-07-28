import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { RequestContext, SpeakInput, SpeakResult } from "../../../packages/core/src/types";
import { ResolvedConfig } from "./config";
export class ElevenLabsTTS {
    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    constructor(client: ElevenLabsClient, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const response = await this.#client.textToSpeech.convert({
            
        })   
    }
}