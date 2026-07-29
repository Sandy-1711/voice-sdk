import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { collectAudio, decodeBase64, ValidationError, withProviderOptions } from "@voice-sdk/core";
import type { AudioStream, RequestContext, SpeakInput, SpeakResult } from "@voice-sdk/core";
import { PROVIDER, type ResolvedConfig } from "./config";
import {
    assertCharacterTimings,
    DEFAULT_FORMAT,
    fromAlignment,
    toOutputFormat,
    toRequestOptions,
    toStreamOutputFormat,
    toVoiceSettings,
} from "./format";

type OutputFormatValue =
    | ElevenLabs.TextToSpeechConvertRequestOutputFormat
    | ElevenLabs.TextToSpeechStreamRequestOutputFormat;

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
        const body = this.#body(input, value);
        const options = toRequestOptions(context);

        // convertWithTimestamps returns JSON carrying base64 audio, where
        // convert returns an audio stream, so each needs its own handling.
        if (input.timings) {
            assertCharacterTimings(input.timings);
            const response = await this.#client.textToSpeech.convertWithTimestamps(voice, body, options);
            return {
                audio: decodeBase64(response.audioBase64),
                format: resolved,
                alignment: fromAlignment(response.alignment ?? response.normalizedAlignment),
                raw: response,
            };
        }

        const stream = await this.#client.textToSpeech.convert(voice, body, options);
        return { audio: await collectAudio(stream), format: resolved };
    }

    /**
     * Output streaming. `timings` switches to the endpoint that carries
     * alignment, which is used to stamp each chunk's offset — the character
     * spans themselves have nowhere to live on an AudioChunk, so use `speak`
     * or a session if you need them.
     */
    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        const voice = this.#voice(input.voice);
        const { value, resolved } = toStreamOutputFormat(
            input.format ?? this.#config.defaultFormat,
            DEFAULT_FORMAT,
        );
        const body = this.#body(input, value);
        const options = toRequestOptions(context);
        const client = this.#client;

        if (input.timings) {
            assertCharacterTimings(input.timings);
            return {
                format: resolved,
                async *[Symbol.asyncIterator]() {
                    const chunks = await client.textToSpeech.streamWithTimestamps(voice, body, options);
                    for await (const chunk of chunks) {
                        const alignment = chunk.alignment ?? chunk.normalizedAlignment;
                        yield {
                            data: decodeBase64(chunk.audioBase64),
                            offset: alignment?.characterStartTimesSeconds[0],
                        };
                    }
                },
            };
        }

        return {
            format: resolved,
            async *[Symbol.asyncIterator]() {
                const stream = await client.textToSpeech.stream(voice, body, options);
                const reader = stream.getReader();
                try {
                    for (;;) {
                        const { done, value: bytes } = await reader.read();
                        if (done) break;
                        if (bytes) yield { data: bytes };
                    }
                } finally {
                    reader.releaseLock();
                }
            },
        };
    }

    /** Generic so the narrower streaming format survives into the request. */
    #body<T extends OutputFormatValue>(input: SpeakInput, outputFormat: T) {
        return withProviderOptions(
            {
                text: input.text,
                modelId: input.model ?? this.#config.defaultModel,
                languageCode: input.language,
                voiceSettings: toVoiceSettings(input.controls),
                outputFormat,
            },
            input.providerOptions,
        );
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
