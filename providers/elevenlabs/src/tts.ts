import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { collectAudio, ValidationError } from "@voice-sdk/core";
import type { Alignment, RequestContext, SpeakInput, SpeakResult } from "@voice-sdk/core";
import { PROVIDER, type ResolvedConfig } from "./config";
import { DEFAULT_FORMAT, toOutputFormat, toVoiceSettings } from "./format";
import { decodeBase64 } from "./internal/base64";

export class ElevenLabsTTS {
    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    constructor(client: ElevenLabsClient, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const voice = this.#voice(input.voice);
        const { value, resolved } = toOutputFormat(
            input.format ?? this.#config.defaultFormat,
            DEFAULT_FORMAT,
        );
        const body = {
            text: input.text,
            modelId: input.model ?? this.#config.defaultModel,
            languageCode: input.language,
            voiceSettings: toVoiceSettings(input.controls),
            outputFormat: value,
            ...(input.providerOptions ?? {}),
        };
        const options = requestOptions(context);

        // Timestamps come from a separate endpoint that returns base64 JSON
        // instead of an audio stream.
        if (input.timings) {
            assertCharacterTimings(input.timings);
            const response = await this.#client.textToSpeech.convertWithTimestamps(voice, body, options);
            return {
                audio: decodeBase64(response.audioBase64),
                format: resolved,
                alignment: toAlignment(response.alignment ?? response.normalizedAlignment),
                raw: response,
            };
        }

        const stream = await this.#client.textToSpeech.convert(voice, body, options);
        return { audio: await collectAudio(stream), format: resolved };
    }

    #voice(voice: string | undefined): string {
        const id = voice ?? this.#config.defaultVoice;
        if (!id) {
            throw new ValidationError(
                PROVIDER,
                "voice",
                "A voice id is required. Pass `voice` or set `defaultVoice` on the provider.",
            );
        }
        return id;
    }
}

/** ElevenLabs aligns per character, so word and phoneme requests cannot be met. */
function assertCharacterTimings(timings: NonNullable<SpeakInput["timings"]>): void {
    if (timings !== true && timings !== "character") {
        throw new ValidationError(
            PROVIDER,
            "timings",
            `"${timings}" is not supported. ElevenLabs reports character-level timings only.`,
        );
    }
}

function toAlignment(
    alignment: ElevenLabs.CharacterAlignmentResponseModel | undefined,
): Alignment | undefined {
    if (!alignment) return undefined;

    return {
        unit: "character",
        spans: alignment.characters.map((text, index) => ({
            text,
            start: alignment.characterStartTimesSeconds[index] ?? 0,
            end: alignment.characterEndTimesSeconds[index] ?? 0,
        })),
    };
}

function requestOptions(context?: RequestContext) {
    return {
        abortSignal: context?.signal,
        // Core counts timeouts in milliseconds, ElevenLabs in seconds.
        timeoutInSeconds: context?.timeout === undefined ? undefined : context.timeout / 1000,
        maxRetries: context?.retries,
    };
}
