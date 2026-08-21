import { collectAudio, withProviderOptions } from "@swungstudent/voice";
import type { RequestContext, TranscribeInput, TranscriptResult } from "@swungstudent/voice";
import type { ResolvedConfig } from "./config";
import { toSTTFormat } from "./format";
import { buildUrl, send, type QueryValue } from "./internal/http";

/** Wire shape of `POST /stt`, narrowed to what `TranscriptResult` carries. */
interface TranscriptionResponse {
    text: string;
    duration?: number;
    language?: string;
    request_id?: string;
    words?: { word: string; start: number; end: number }[];
}

/** Cartesia reads these off the query string; everything else is multipart. */
const QUERY_FIELDS = ["encoding", "sample_rate"] as const;

export class CartesiaSTT {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        const fields = withProviderOptions(
            {
                file: await collectAudio(input.audio),
                model: input.model ?? this.#config.defaultSTTModel,
                language: input.language,
                ...toSTTFormat(input.format),
                // Word is the only granularity Cartesia offers.
                timestamp_granularities: input.timestamps ? ["word" as const] : undefined,
            },
            input.providerOptions,
        );

        const { query, body } = split(fields);
        const response = await send({
            apiKey: this.#config.apiKey,
            url: buildUrl(this.#config.baseUrl, "/stt", query),
            body,
            // Deliberately unset: FormData writes its own header, and setting
            // one here would drop the multipart boundary with it.
            operation: "transcribe",
            transport: this.#config.transport,
            context,
        });

        const payload = (await response.json()) as TranscriptionResponse;

        return {
            text: payload.text,
            duration: payload.duration,
            language: payload.language,
            requestId: payload.request_id,
            words: payload.words?.map((word) => ({
                text: word.word,
                start: word.start,
                end: word.end,
            })),
            raw: payload,
        };
    }
}

/** Splits the mapped request into its query half and its multipart half. */
function split(fields: Record<string, unknown>): { query: Record<string, QueryValue>; body: FormData } {
    const query: Record<string, QueryValue> = {};
    const form = new FormData();

    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;

        if ((QUERY_FIELDS as readonly string[]).includes(key)) {
            query[key] = value as QueryValue;
        } else if (key === "file") {
            form.append(key, new Blob([value as BlobPart]), "audio");
        } else if (Array.isArray(value)) {
            // Arrays repeat the key, which is how timestamp_granularities travels.
            for (const item of value) form.append(key, String(item));
        } else if (typeof value === "object") {
            form.append(key, JSON.stringify(value));
        } else {
            form.append(key, String(value as string | number | boolean));
        }
    }

    return { query, body: form };
}
