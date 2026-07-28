import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import type { ResolvedConfig } from "./config"
import type { AudioSource, TranscribeInput, RequestContext, TranscriptResult, TranscriptWord } from "@voice-sdk/core";
import { collectAudio, ValidationError, VoiceError } from "@voice-sdk/core";

export class ElevenLabsSTT {
    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    constructor(client: ElevenLabsClient, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {

        const response = await this.#client.speechToText.convert({
            ...(await toSource(input.audio)),
            modelId: (input.model ?? this.#config.defaultSTTModel) as ElevenLabs.SpeechToTextConvertRequestModelId,
            languageCode: input.language,
            timestampsGranularity: toGranularity(input.timestamps),
            diarize: input.diarize,
            numSpeakers: input.speakerCount,
            ...(input.providerOptions ?? {}),
        }, {
            abortSignal: context?.signal,
            // Core counts timeouts in milliseconds, ElevenLabs in seconds.
            timeoutInSeconds: context?.timeout === undefined ? undefined : context.timeout / 1000,
            maxRetries: context?.retries,
        });

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
            words: response.words.length > 0 ? response.words.map(toWord) : undefined,
            raw: response,
        };
    }

}

/** ElevenLabs takes a URL natively, so skip the round trip when given one. */
async function toSource(audio: AudioSource) {
    if ("url" in audio) return { sourceUrl: audio.url };
    return { file: await collectAudio(audio) };
}

const GRANULARITY = {
    word: "word",
    character: "character",
} as const;

function toGranularity(
    timestamps: TranscribeInput["timestamps"],
): ElevenLabs.SpeechToTextConvertRequestTimestampsGranularity {
    if (!timestamps) return "none";

    const granularity = GRANULARITY[timestamps as keyof typeof GRANULARITY];
    if (!granularity) {
        throw new ValidationError(
            "elevenlabs",
            "timestamps",
            `"${timestamps}" is not supported. Supported: ${Object.keys(GRANULARITY).join(", ")}.`,
        );
    }
    return granularity;
}

/** `logprob` is a log probability in [-inf, 0], not a 0-1 confidence. */
function toWord(word: ElevenLabs.SpeechToTextWordResponseModel): TranscriptWord {
    return {
        text: word.text,
        start: word.start ?? 0,
        end: word.end ?? 0,
        confidence: Math.exp(word.logprob),
        speaker: word.speakerId,
        kind: word.type,
    };
}
