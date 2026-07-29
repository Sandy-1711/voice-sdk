import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import type { RequestContext, TranscribeInput, TranscriptResult } from "@voice-sdk/core";
import { VoiceError } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { fromWord, toFileFormat, toGranularity, toRequestOptions, toSource } from "./format";

export class ElevenLabsSTT {
    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    constructor(client: ElevenLabsClient, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        const response = await this.#client.speechToText.convert(
            {
                ...(await toSource(input.audio)),
                modelId: (input.model ?? this.#config.defaultSTTModel) as ElevenLabs.SpeechToTextConvertRequestModelId,
                languageCode: input.language,
                fileFormat: toFileFormat(input.format),
                timestampsGranularity: toGranularity(input.timestamps),
                diarize: input.diarize,
                numSpeakers: input.speakerCount,
                keyterms: input.keyterms,
                ...(input.providerOptions ?? {}),
            },
            toRequestOptions(context),
        );

        if (!("text" in response)) {
            throw new VoiceError(
                "ElevenLabs returned a multichannel or webhook response, which has no core equivalent. Drop `useMultiChannel` / `webhook` from providerOptions.",
            );
        }

        return {
            text: response.text,
            language: response.languageCode,
            languageConfidence: response.languageProbability,
            duration: response.audioDurationSecs,
            requestId: response.transcriptionId,
            words: response.words.length > 0 ? response.words.map(fromWord) : undefined,
            raw: response,
        };
    }
}
