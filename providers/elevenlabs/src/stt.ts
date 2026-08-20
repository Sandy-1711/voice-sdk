import type { RequestContext, TranscribeInput, TranscriptResult } from "@swungstudent/voice";
import { VoiceError, withProviderOptions } from "@swungstudent/voice";
import { DEFAULT_BASE_URL, type ResolvedConfig } from "./config";
import { fromWord, toFileFormat, toGranularity, toSource, type WordResponse } from "./format";
import { camelize, send } from "./internal/http";

/** Wire shape of `POST /v1/speech-to-text`, after camelising. */
interface TranscriptionResponse {
    text?: string;
    languageCode?: string;
    languageProbability?: number;
    audioDurationSecs?: number;
    transcriptionId?: string;
    words?: WordResponse[];
}

export class ElevenLabsSTT {
    #config: ResolvedConfig;

    constructor(config: ResolvedConfig) {
        this.#config = config;
    }

    async transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        const fields = withProviderOptions({
            ...(await toSource(input.audio)),
            modelId: input.model ?? this.#config.defaultSTTModel,
            languageCode: input.language,
            fileFormat: toFileFormat(input.format),
            timestampsGranularity: toGranularity(input.timestamps),
            diarize: input.diarize,
            numSpeakers: input.speakerCount,
            keyterms: input.keyterms,
        }, input.providerOptions);

        const url = new URL("/v1/speech-to-text", this.#config.baseUrl ?? DEFAULT_BASE_URL);
        const response = await send({
            apiKey: this.#config.apiKey,
            url,
            body: toFormData(fields),
            // Deliberately unset: FormData writes its own header, and setting
            // one here would drop the multipart boundary with it.
            operation: "transcribe",
            transport: this.#config.transport,
            context,
        });

        const payload = camelize(await response.json()) as TranscriptionResponse;

        if (typeof payload.text !== "string") {
            throw new VoiceError(
                "ElevenLabs returned a multichannel or webhook response, which has no core equivalent. Drop `useMultiChannel` / `webhook` from providerOptions.",
            );
        }

        return {
            text: payload.text,
            language: payload.languageCode,
            languageConfidence: payload.languageProbability,
            duration: payload.audioDurationSecs,
            requestId: payload.transcriptionId,
            words: payload.words && payload.words.length > 0 ? payload.words.map(fromWord) : undefined,
            raw: payload,
        };
    }
}

/**
 * The endpoint is multipart, not JSON, so each field is appended under its
 * snake_case name. Arrays repeat the key, which is how keyterms travel, and
 * `file` is the only part that stays binary.
 */
function toFormData(fields: Record<string, unknown>): FormData {
    const form = new FormData();

    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        const name = toSnakeCase(key);

        if (name === "file") {
            form.append(name, new Blob([value as unknown as BlobPart]), "audio");
        } else if (Array.isArray(value)) {
            for (const item of value) form.append(name, String(item));
        } else if (typeof value === "object") {
            form.append(name, JSON.stringify(value));
        } else {
            form.append(name, String(value));
        }
    }

    return form;
}

function toSnakeCase(key: string): string {
    return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
