import type {
    AudioStream,
    RequestContext,
    ResolvedAudioFormat,
    SpeakInput,
    SpeakResult,
} from "@swungstudent/voice";
import { withProviderOptions } from "@swungstudent/voice";
import type { ResolvedConfig } from "./config";
import { DEFAULT_FORMAT, DEFAULT_STREAM_FORMAT } from "./config";
import { assertNoTimings, toOutputFormat, toSpeed } from "./format";
import { buildUrl, send } from "./internal/http";

export class DeepgramTTS {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const { resolved, url } = this.#request(input, DEFAULT_FORMAT);

        const response = await send({
            apiKey: this.#config.apiKey,
            url,
            body: JSON.stringify({ text: input.text }),
            contentType: "application/json",
            context,
        });

        return {
            audio: new Uint8Array(await response.arrayBuffer()),
            format: resolved,
            requestId: response.headers.get("dg-request-id") ?? undefined,
        };
    }

    /**
     * `/v1/speak` answers with a chunked body, so output streaming is the same
     * request read incrementally rather than a separate endpoint.
     */
    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        const { resolved, url } = this.#request(input, DEFAULT_STREAM_FORMAT);
        const apiKey = this.#config.apiKey;

        return {
            format: resolved,
            async *[Symbol.asyncIterator]() {
                const response = await send({
                    apiKey,
                    url,
                    body: JSON.stringify({ text: input.text }),
                    contentType: "application/json",
                    context,
                });
                if (!response.body) return;

                const reader = response.body.getReader();
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) yield { data: value };
                    }
                } finally {
                    reader.releaseLock();
                }
            },
        };
    }

    /** Format is resolved before the call, so a bad one throws without a round trip. */
    #request(input: SpeakInput, fallback: ResolvedAudioFormat) {
        assertNoTimings(input.timings);

        const { params, resolved } = toOutputFormat(input.format ?? this.#config.defaultFormat, fallback);
        const query = withProviderOptions({
            ...params,
            // Deepgram has neither a voice nor a language parameter — both are
            // folded into the model name, as in `aura-2-thalia-en`.
            model: input.model ?? input.voice ?? this.#config.defaultModel,
            speed: toSpeed(input.controls),
        }, input.providerOptions);

        return { resolved, url: buildUrl(this.#config.baseUrl, "/v1/speak", query) };
    }
}
