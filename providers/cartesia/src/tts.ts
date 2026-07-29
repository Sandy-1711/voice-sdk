import type { Cartesia } from "@cartesia/cartesia-js";
import type {
    AudioStream,
    Alignment,
    RequestContext,
    SpeakInput,
    SpeakResult,
} from "@voice-sdk/core";
import { decodeBase64 } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { DEFAULT_FORMAT, DEFAULT_STREAM_FORMAT } from "./config";
import { toGenerationConfig, toOutputFormat, toRawOutputFormat, toVoice } from "./format";


export class CartesiaTTS {
    #client: Cartesia;
    #config: ResolvedConfig;

    constructor(client: Cartesia, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        const { payload, resolved } = toOutputFormat(input.format ?? this.#config.defaultFormat, DEFAULT_FORMAT);

        const response = await this.#client.tts.generate(
            { ...this.#body(input), output_format: payload },
            requestOptions(context),
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
        const body = this.#body(input);
        const client = this.#client;

        return {
            format: resolved,
            async *[Symbol.asyncIterator]() {
                const events = await client.tts.generateSSE(
                    { ...body, output_format: payload, add_timestamps: Boolean(input.timings) },
                    requestOptions(context),
                );
                for await (const event of events) {
                    if (event.type === "chunk") yield { data: decodeBase64(event.data) };
                }
            },
        };
    }

    /** Everything but `output_format`, which differs per endpoint. */
    #body(input: SpeakInput) {
        return {
            model_id: (input.model ?? this.#config.defaultModel) as Cartesia.TTSModel,
            transcript: input.text,
            voice: toVoice(input.voice ?? this.#config.defaultVoice),
            language: input.language as Cartesia.SupportedLanguage | undefined,
            generation_config: toGenerationConfig(input.controls),
            ...(input.providerOptions ?? {}),
        };
    }
}

/** Cartesia returns parallel arrays; core carries spans. */
export function fromTimestamps(
    labels: string[],
    start: number[],
    end: number[],
    unit: Alignment["unit"],
): Alignment {
    return {
        unit,
        spans: labels.map((text, index) => ({
            text,
            start: start[index] ?? 0,
            end: end[index] ?? 0,
        })),
    };
}

function requestOptions(context?: RequestContext) {
    return {
        signal: context?.signal,
        timeout: context?.timeout,
        maxRetries: context?.retries,
    };
}
