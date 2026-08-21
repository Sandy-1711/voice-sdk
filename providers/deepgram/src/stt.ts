import type {
    RequestContext,
    TranscribeInput,
    TranscriptResult,
    TranscriptSegment,
} from "@swungstudent/voice";
import { collectAudio, ValidationError, withProviderOptions } from "@swungstudent/voice";
import { PROVIDER, type ResolvedConfig } from "./config";
import { fromWords, toSTTFormat, type WireWord } from "./format";
import { buildUrl, send } from "./internal/http";

/** Wire shape of `POST /v1/listen`, narrowed to the fields core models. */
interface ListenResponse {
    metadata?: {
        request_id?: string;
        duration?: number;
    };
    results?: {
        channels?: {
            detected_language?: string;
            alternatives?: {
                transcript?: string;
                confidence?: number;
                languages?: string[];
                words?: WireWord[];
            }[];
        }[];
        utterances?: {
            transcript?: string;
            start?: number;
            end?: number;
            confidence?: number;
            speaker?: number;
        }[];
    };
}

export class DeepgramSTT {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        if (input.timestamps === "character") {
            throw new ValidationError(
                PROVIDER,
                "timestamps",
                `"character" is not supported. Deepgram reports word and segment timings only.`,
            );
        }

        const query = withProviderOptions(
            {
                ...toSTTFormat(input.format),
                model: input.model ?? this.#config.defaultSTTModel,
                language: input.language,
                diarize: input.diarize,
                keyterm: input.keyterms,
                // Deepgram groups words into utterances only when asked, and that
                // grouping is the only thing core's `segments` can be built from.
                utterances: input.timestamps === "segment" ? true : undefined,
            },
            input.providerOptions,
        );

        const url = buildUrl(this.#config.baseUrl, "/v1/listen", query);

        // Deepgram takes a URL natively, so skip the round trip when given one.
        const isUrl = typeof input.audio === "object" && input.audio !== null && "url" in input.audio;
        const response = await send({
            apiKey: this.#config.apiKey,
            url,
            body: isUrl
                ? JSON.stringify({ url: (input.audio as { url: string }).url })
                : await collectAudio(input.audio),
            contentType: isUrl ? "application/json" : "application/octet-stream",
            operation: "transcribe",
            transport: this.#config.transport,
            context,
        });

        return this.#result((await response.json()) as ListenResponse, input);
    }

    #result(response: ListenResponse, input: TranscribeInput): TranscriptResult {
        const channel = response.results?.channels?.[0];
        const best = channel?.alternatives?.[0];

        return {
            text: best?.transcript ?? "",
            language: channel?.detected_language ?? best?.languages?.[0] ?? input.language,
            duration: response.metadata?.duration,
            confidence: best?.confidence,
            requestId: response.metadata?.request_id,
            // Deepgram always times its words, so the flag only decides whether
            // to hand them back — there is nothing to switch off upstream.
            words: input.timestamps === false ? undefined : fromWords(best?.words),
            segments: fromUtterances(response.results?.utterances),
            raw: response,
        };
    }
}

function fromUtterances(
    utterances: NonNullable<ListenResponse["results"]>["utterances"],
): TranscriptSegment[] | undefined {
    if (!utterances || utterances.length === 0) return undefined;

    return utterances.map((utterance) => ({
        text: utterance.transcript ?? "",
        start: utterance.start ?? 0,
        end: utterance.end ?? 0,
        confidence: utterance.confidence,
        speaker: utterance.speaker === undefined ? undefined : String(utterance.speaker),
    }));
}
