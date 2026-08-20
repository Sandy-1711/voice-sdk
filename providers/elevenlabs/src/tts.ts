import { decodeBase64, ValidationError, withProviderOptions } from "@swungstudent/voice";
import type { AudioStream, RequestContext, SpeakInput, SpeakResult } from "@swungstudent/voice";
import { DEFAULT_BASE_URL, PROVIDER, type ResolvedConfig } from "./config";
import {
    assertCharacterTimings,
    DEFAULT_FORMAT,
    fromAlignment,
    toOutputFormat,
    toStreamOutputFormat,
    toVoiceSettings,
    type CharacterAlignment,
} from "./format";
import { camelize, send, snakeify } from "./internal/http";

/** Wire shape of the two `/with-timestamps` endpoints, after camelising. */
interface TimestampedAudio {
    audioBase64: string;
    alignment?: CharacterAlignment;
    normalizedAlignment?: CharacterAlignment;
}

export class ElevenLabsTTS {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const voice = this.#voice(input.voice);
        const { value, resolved } = toOutputFormat(
            input.format ?? this.#config.defaultFormat,
            DEFAULT_FORMAT,
        );

        // `/with-timestamps` answers with JSON carrying base64 audio, where the
        // plain endpoint answers with the audio itself, so each needs its own
        // handling.
        if (input.timings) {
            assertCharacterTimings(input.timings);
            const response = await this.#post({ voice, path: "/with-timestamps", input, value, operation: "speak", context });
            const payload = camelize(await response.json()) as TimestampedAudio;

            return {
                audio: decodeBase64(payload.audioBase64),
                format: resolved,
                alignment: fromAlignment(payload.alignment ?? payload.normalizedAlignment),
                raw: payload,
            };
        }

        const response = await this.#post({ voice, path: "", input, value, operation: "speak", context });
        return { audio: new Uint8Array(await response.arrayBuffer()), format: resolved };
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
        if (input.timings) assertCharacterTimings(input.timings);

        // Everything above runs now, so a bad format throws from the call
        // rather than from the first `for await`. The request itself waits.
        const timings = Boolean(input.timings);
        const post = () =>
            this.#post({
                voice,
                path: timings ? "/stream/with-timestamps" : "/stream",
                input,
                value,
                operation: "speakStream",
                stream: true,
                context,
            });

        if (timings) {
            return {
                format: resolved,
                async *[Symbol.asyncIterator]() {
                    const response = await post();
                    if (!response.body) return;

                    // One JSON object per line, each with its own alignment.
                    for await (const line of lines(response.body)) {
                        const chunk = camelize(JSON.parse(line)) as TimestampedAudio;
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
                const response = await post();
                if (!response.body) return;

                const reader = response.body.getReader();
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

    #post({ voice, path, input, value, operation, stream, context }: {
        voice: string;
        path: string;
        input: SpeakInput;
        value: string;
        operation: string;
        stream?: boolean;
        context?: RequestContext;
    }): Promise<Response> {
        const url = new URL(
            `/v1/text-to-speech/${encodeURIComponent(voice)}${path}`,
            this.#config.baseUrl ?? DEFAULT_BASE_URL,
        );
        // The format rides in the query; everything else is in the body.
        url.searchParams.set("output_format", value);

        return send({
            apiKey: this.#config.apiKey,
            url,
            body: JSON.stringify(snakeify(this.#body(input))),
            contentType: "application/json",
            operation,
            stream,
            transport: this.#config.transport,
            context,
        });
    }

    #body(input: SpeakInput) {
        return withProviderOptions(
            {
                text: input.text,
                modelId: input.model ?? this.#config.defaultModel,
                languageCode: input.language,
                voiceSettings: toVoiceSettings(input.controls),
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

/** Splits a chunked body on newlines, since a JSON object can span two reads. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (line) yield line;
            }
        }

        const rest = buffer.trim();
        if (rest) yield rest;
    } finally {
        reader.releaseLock();
    }
}
