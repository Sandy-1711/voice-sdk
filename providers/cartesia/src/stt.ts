import { toFile, type Cartesia } from "@cartesia/cartesia-js";
import { collectAudio } from "@voice-sdk/core";
import type { RequestContext, TranscribeInput, TranscriptResult } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { toSTTEncoding } from "./format";

export class CartesiaSTT {
    #client: Cartesia;
    #config: ResolvedConfig;

    constructor(client: Cartesia, config: ResolvedConfig) {
        this.#client = client;
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        const response = await this.#client.stt.transcribe(
            {
                file: await toFile(await collectAudio(input.audio), "audio"),
                model: (input.model ?? this.#config.defaultSTTModel) as Cartesia.STTBatchModel,
                language: input.language,
                encoding: toSTTEncoding(input.format),
                sample_rate: input.format?.sampleRate,
                // Word is the only granularity Cartesia offers.
                timestamp_granularities: input.timestamps ? ["word"] : undefined,
                ...(input.providerOptions ?? {}),
            },
            {
                signal: context?.signal,
                timeout: context?.timeout,
                maxRetries: context?.retries,
            },
        );

        return {
            text: response.text,
            duration: response.duration,
            language: response.language,
            requestId: response.request_id,
            words: response.words?.map((word) => ({
                text: word.word,
                start: word.start,
                end: word.end,
            })),
            raw: response,
        };
    }
}
