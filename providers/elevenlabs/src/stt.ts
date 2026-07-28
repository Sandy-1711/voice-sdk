import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ResolvedConfig } from "./config"
import type { TranscribeInput, RequestContext, TranscriptResult } from "@voice-sdk/core";
import { collectAudio } from "@voice-sdk/core";
export class ElevenLabsSTT {
    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    constructor(client: ElevenLabsClient, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {

        await this.#client.speechToText.convert({
            file: new Blob([await collectAudio(input.audio)], { type: "audio/wav" }),
            modelId: input.model,
            languageCode: input.language,
        }, {
            abortSignal: context?.signal,
            timeoutInSeconds: context?.timeout,
            maxRetries: context?.retries,
        });
    }

}
