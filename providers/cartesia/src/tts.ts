import type { AudioStream, RequestContext, SpeakInput, SpeakResult } from "@swungstudent/voice";
import { decodeBase64, VoiceError, withProviderOptions } from "@swungstudent/voice";
import type { ResolvedConfig } from "./config";
import { DEFAULT_FORMAT, DEFAULT_STREAM_FORMAT } from "./config";
import { toGenerationConfig, toOutputFormat, toRawOutputFormat, toVoice } from "./format";
import { buildUrl, send } from "./internal/http";
import { sseEvents } from "./internal/sse";

/** Wire shape of the events `/tts/sse` sends. */
interface SSEEvent {
    type: string;
    data?: string;
    title?: string;
    message?: string;
}

export class CartesiaTTS {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const { payload, resolved } = toOutputFormat(
            input.format ?? this.#config.defaultFormat,
            DEFAULT_FORMAT,
        );

        const response = await this.#post(
            "/tts/bytes",
            { ...this.#body(input), output_format: payload },
            "speak",
            false,
            context,
        );

        return {
            audio: new Uint8Array(await response.arrayBuffer()),
            format: resolved,
            requestId: response.headers.get("x-request-id") ?? undefined,
        };
    }

    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        const { payload, resolved } = toRawOutputFormat(
            input.format ?? this.#config.defaultFormat,
            DEFAULT_STREAM_FORMAT,
        );
        // Everything above runs now, so a bad format throws from the call
        // rather than from the first `for await`. The request itself waits.
        const body = {
            ...this.#body(input),
            output_format: payload,
            add_timestamps: Boolean(input.timings),
        };
        const post = () => this.#post("/tts/sse", body, "speakStream", true, context);

        return {
            format: resolved,
            async *[Symbol.asyncIterator]() {
                const response = await post();
                if (!response.body) return;

                for await (const event of sseEvents<SSEEvent>(response.body)) {
                    switch (event.type) {
                        case "chunk":
                            if (event.data) yield { data: decodeBase64(event.data) };
                            break;
                        case "done":
                            return;
                        case "error":
                            throw new VoiceError(
                                `Cartesia speakStream failed: ${event.title}: ${event.message}`,
                            );
                    }
                }
            },
        };
    }

    #post(
        path: string,
        body: object,
        operation: string,
        stream: boolean,
        context?: RequestContext,
    ): Promise<Response> {
        return send({
            apiKey: this.#config.apiKey,
            url: buildUrl(this.#config.baseUrl, path),
            body: JSON.stringify(body),
            contentType: "application/json",
            operation,
            stream,
            transport: this.#config.transport,
            context,
        });
    }

    /** Everything but `output_format`, which differs per endpoint. */
    #body(input: SpeakInput) {
        return withProviderOptions(
            {
                model_id: input.model ?? this.#config.defaultModel,
                transcript: input.text,
                voice: toVoice(input.voice ?? this.#config.defaultVoice),
                language: input.language,
                generation_config: toGenerationConfig(input.controls),
            },
            input.providerOptions,
        );
    }
}
