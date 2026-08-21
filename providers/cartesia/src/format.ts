import { ValidationError } from "@swungstudent/voice";
import type {
    Alignment,
    AudioEncoding,
    AudioFormat,
    ResolvedAudioFormat,
    TranscriptWord,
    VoiceControls,
} from "@swungstudent/voice";
import { PROVIDER } from "./config";

// Translation between core's vocabulary and Cartesia's. Naming convention
// across every provider:
//   to<Thing>   core -> provider   (building a request)
//   from<Thing> provider -> core   (reading a response)

// Cartesia's own vocabulary. `model`, `language` and `emotion` are open string
// unions on the wire, so they are typed as strings rather than restated here —
// a closed list would go stale every time Cartesia ships a voice or a model.

export type SampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export type BitRate = 32000 | 64000 | 96000 | 128000 | 192000;

export type RawEncoding = "pcm_f32le" | "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";
export type STTEncoding = "pcm_s16le" | "pcm_s32le" | "pcm_f16le" | "pcm_f32le" | "pcm_mulaw" | "pcm_alaw";

export interface RawOutputFormat {
    container: "raw";
    encoding: RawEncoding;
    sample_rate: SampleRate;
}

export interface WAVOutputFormat {
    container: "wav";
    encoding: RawEncoding;
    sample_rate: SampleRate;
}

export interface MP3OutputFormat {
    container: "mp3";
    bit_rate: BitRate;
    sample_rate: SampleRate;
}

export type CartesiaOutputFormat = RawOutputFormat | WAVOutputFormat | MP3OutputFormat;

/** Only for `sonic-3` and newer; earlier models ignore it. */
export interface GenerationConfig {
    emotion?: string;
    speed?: number;
    volume?: number;
}

export interface VoiceSpecifier {
    mode: "id";
    id: string;
}

const SAMPLE_RATES: SampleRate[] = [8000, 16000, 22050, 24000, 44100, 48000];
const BIT_RATES: BitRate[] = [32000, 64000, 96000, 128000, 192000];

/** Core names the bare codec (`mulaw`); Cartesia prefixes everything with `pcm_`. */
const RAW_ENCODING: Partial<Record<AudioEncoding, RawEncoding>> = {
    pcm_s16le: "pcm_s16le",
    pcm_f32le: "pcm_f32le",
    mulaw: "pcm_mulaw",
    alaw: "pcm_alaw",
};

const STT_ENCODING: Partial<Record<AudioEncoding, STTEncoding>> = {
    pcm_s16le: "pcm_s16le",
    pcm_s32le: "pcm_s32le",
    pcm_f32le: "pcm_f32le",
    mulaw: "pcm_mulaw",
    alaw: "pcm_alaw",
};

export interface OutputFormat {
    payload: CartesiaOutputFormat;
    resolved: ResolvedAudioFormat;
}

/**
 * Lowers a requested format onto Cartesia's vocabulary. Throws rather than
 * substituting, since the wrong encoding produces unplayable bytes.
 */
export function toOutputFormat(
    requested: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): OutputFormat {
    const container = requested?.container ?? fallback.container;
    const encoding = requested?.encoding ?? fallback.encoding;
    const sampleRate = requested?.sampleRate ?? fallback.sampleRate;
    const channels = requested?.channels ?? fallback.channels;
    const bitrate = requested?.bitrate ?? fallback.bitrate;

    if (channels !== 1) {
        throw new ValidationError(
            PROVIDER,
            "format.channels",
            `Cartesia only generates mono audio, got ${channels}.`,
        );
    }
    if (!isSampleRate(sampleRate)) {
        throw new ValidationError(
            PROVIDER,
            "format.sampleRate",
            `${sampleRate} is not supported. Supported: ${SAMPLE_RATES.join(", ")}.`,
        );
    }

    if (container === "mp3") {
        const bitRate = (bitrate ?? 128) * 1000;
        if (!isBitRate(bitRate)) {
            throw new ValidationError(
                PROVIDER,
                "format.bitrate",
                `${bitrate} kbps is not supported. Supported: ${BIT_RATES.map((rate) => rate / 1000).join(", ")}.`,
            );
        }
        return {
            payload: { container, bit_rate: bitRate, sample_rate: sampleRate },
            resolved: { container, encoding: "mp3", sampleRate, channels: 1, bitrate: bitRate / 1000 },
        };
    }

    if (container !== "raw" && container !== "wav") {
        throw new ValidationError(
            PROVIDER,
            "format.container",
            `"${container}" is not supported. Supported: raw, wav, mp3.`,
        );
    }

    const rawEncoding = RAW_ENCODING[encoding];
    if (!rawEncoding) {
        throw new ValidationError(
            PROVIDER,
            "format.encoding",
            `"${encoding}" has no Cartesia equivalent. Supported: ${Object.keys(RAW_ENCODING).join(", ")}.`,
        );
    }

    return {
        payload: { container, encoding: rawEncoding, sample_rate: sampleRate },
        resolved: { container, encoding, sampleRate, channels: 1 },
    };
}

/** The SSE and WebSocket endpoints only accept raw output. */
export function toRawOutputFormat(
    requested: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { payload: RawOutputFormat; resolved: ResolvedAudioFormat } {
    const { payload, resolved } = toOutputFormat(requested, fallback);
    if (payload.container !== "raw") {
        throw new ValidationError(
            PROVIDER,
            "format.container",
            `Streaming synthesis only supports the "raw" container, got "${payload.container}". Use speak() for ${payload.container}.`,
        );
    }
    return { payload, resolved };
}

/**
 * Both STT endpoints take the input format as an `encoding` + `sample_rate`
 * pair on the query string, so that pair is what the mappers return — the same
 * shape Deepgram's `toSTTFormat` and `toRealtimeSTTFormat` hand back.
 *
 * Unlike Deepgram, Cartesia does not sniff containers, so whatever the caller
 * named is sent as named. Batch leaves both fields off when unset and lets
 * Cartesia read the file header instead.
 */
export function toSTTFormat(format: AudioFormat | undefined): {
    encoding?: STTEncoding;
    sample_rate?: number;
} {
    return { encoding: toSTTEncoding(format?.encoding), sample_rate: format?.sampleRate };
}

/** Realtime has no header to fall back on, so both fields are always sent. */
export function toRealtimeSTTFormat(
    format: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { encoding: STTEncoding; sample_rate: number } {
    return {
        encoding: toSTTEncoding(format?.encoding) ?? "pcm_s16le",
        sample_rate: format?.sampleRate ?? fallback.sampleRate,
    };
}

function toSTTEncoding(encoding: AudioEncoding | undefined): STTEncoding | undefined {
    if (!encoding) return undefined;

    const mapped = STT_ENCODING[encoding];
    if (!mapped) {
        throw new ValidationError(
            PROVIDER,
            "format.encoding",
            `"${encoding}" has no Cartesia equivalent. Supported: ${Object.keys(STT_ENCODING).join(", ")}.`,
        );
    }
    return mapped;
}

/** Only speed, volume and emotion have Cartesia equivalents; the rest are ignored. */
export function toGenerationConfig(controls: VoiceControls | undefined): GenerationConfig | undefined {
    if (!controls) return undefined;

    const config: GenerationConfig = {};
    if (controls.speed !== undefined) config.speed = inRange("controls.speed", controls.speed, 0.6, 1.5);
    if (controls.volume !== undefined) config.volume = inRange("controls.volume", controls.volume, 0.5, 2);
    if (controls.emotion !== undefined) config.emotion = controls.emotion;

    return Object.keys(config).length > 0 ? config : undefined;
}

export function toVoice(voice: string | undefined): VoiceSpecifier {
    if (!voice) {
        throw new ValidationError(
            PROVIDER,
            "voice",
            "A voice id is required. Pass `voice` or set `defaultVoice` on the provider.",
        );
    }
    return { mode: "id", id: voice };
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

/**
 * The SDK types realtime word timings as parallel arrays, but the wire sends
 * objects. Accept both rather than trusting either.
 */
export function fromWords(words: unknown): TranscriptWord[] | undefined {
    if (!Array.isArray(words) || words.length === 0) return undefined;

    const out: TranscriptWord[] = [];
    for (const entry of words) {
        if (!entry || typeof entry !== "object") continue;

        const item = entry as Record<string, unknown>;
        if (typeof item.word === "string") {
            out.push({ text: item.word, start: Number(item.start) || 0, end: Number(item.end) || 0 });
            continue;
        }
        if (Array.isArray(item.words)) {
            const starts = Array.isArray(item.start) ? item.start : [];
            const ends = Array.isArray(item.end) ? item.end : [];
            item.words.forEach((text: unknown, index: number) => {
                out.push({
                    text: String(text),
                    start: Number(starts[index]) || 0,
                    end: Number(ends[index]) || 0,
                });
            });
        }
    }
    return out.length > 0 ? out : undefined;
}

function isSampleRate(value: number): value is SampleRate {
    return (SAMPLE_RATES as number[]).includes(value);
}

function isBitRate(value: number): value is BitRate {
    return (BIT_RATES as number[]).includes(value);
}

function inRange(field: string, value: number, min: number, max: number): number {
    if (!(value >= min && value <= max)) {
        throw new ValidationError(
            PROVIDER,
            field,
            `Expected a value between ${min} and ${max}, got ${value}.`,
        );
    }
    return value;
}
