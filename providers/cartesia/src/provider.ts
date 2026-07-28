import { Cartesia, toFile } from '@cartesia/cartesia-js';
import { collectAudio, ConfigError, ValidationError, type VoiceProvider } from "@voice-sdk/core";
import type { TranscribeInput, Transcription, AudioEncoding, AudioFormat, RequestContext } from "@voice-sdk/core";

/** Core names the bare codec (`mulaw`); Cartesia prefixes everything with `pcm_`. */
const STT_ENCODING: Partial<Record<AudioEncoding, Cartesia.STTEncoding>> = {
    pcm_s16le: "pcm_s16le",
    pcm_s32le: "pcm_s32le",
    pcm_f32le: "pcm_f32le",
    mulaw: "pcm_mulaw",
    alaw: "pcm_alaw",
};

/** Resolves a core encoding to Cartesia's spelling, or throws naming the field. */
function toSTTEncoding(format: AudioFormat | undefined) {
    if (!format?.encoding) return undefined;

    const encoding = STT_ENCODING[format.encoding];
    if (!encoding) {
        throw new ValidationError(
            "cartesia",
            "format.encoding",
            `"${format.encoding}" has no Cartesia equivalent. Supported: ${Object.keys(STT_ENCODING).join(", ")}.`,
        );
    }
    if (format.sampleRate !== undefined && !(format.sampleRate > 0)) {
        throw new ValidationError("cartesia", "format.sampleRate", `Expected a positive number, got ${format.sampleRate}.`);
    }
    return encoding;
}
export interface CartesiaProviderConfig {
    apiKey?: string;
}

export class CartesiaProvider implements VoiceProvider {
    readonly name = "cartesia";
    readonly capabilities = {
        tts: true,
        stt: true,
        streamingTTS: false,
        streamingSTT: false,
    };
    #client: Cartesia;
    constructor(config: CartesiaProviderConfig = {}) {
        const apiKey = config.apiKey || process.env.CARTESIA_API_KEY;
        if (!apiKey) {
            throw new ConfigError("cartesia", "apiKey", "Cartesia API key is required. Please provide it in the config or set the CARTESIA_API_KEY environment variable.");
        }
        this.#client = new Cartesia({ apiKey: apiKey });
    }



    async transcribe(input: TranscribeInput, options?: RequestContext): Promise<Transcription> {

        const response = await this.#client.stt.transcribe(
            {
                file: await toFile(await collectAudio(input.audio), "audio"),
                model: input.model,
                language: input.language,
                encoding: toSTTEncoding(input.format),
                sample_rate: input.format?.sampleRate,
                timestamp_granularities: input.timestamps ? ["word"] : undefined,
            },
            {
                signal: options?.signal,
                timeout: options?.timeout,
                maxRetries: options?.retries,
            },
        );

        return {
            text: response.text,
            duration: response.duration,
            language: response.language,
            uniqueId: response.request_id,
            // Only populated when `timestamps` was requested.
            words: response.words ?? [],
        };
    }
}