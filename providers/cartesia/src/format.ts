import type { Cartesia } from "@cartesia/cartesia-js";
import { ValidationError } from "@voice-sdk/core";
import type { AudioEncoding, AudioFormat, ResolvedAudioFormat, VoiceControls } from "@voice-sdk/core";

type CartesiaOutputFormat =
    | Cartesia.RawOutputFormat
    | Cartesia.WAVOutputFormat
    | Cartesia.MP3OutputFormat;

type SampleRate = Cartesia.RawOutputFormat["sample_rate"];
type BitRate = Cartesia.MP3OutputFormat["bit_rate"];

const SAMPLE_RATES: SampleRate[] = [8000, 16000, 22050, 24000, 44100, 48000];
const BIT_RATES: BitRate[] = [32000, 64000, 96000, 128000, 192000];

/** Core names the bare codec (`mulaw`); Cartesia prefixes everything with `pcm_`. */
const RAW_ENCODING: Partial<Record<AudioEncoding, Cartesia.RawEncoding>> = {
    pcm_s16le: "pcm_s16le",
    pcm_f32le: "pcm_f32le",
    mulaw: "pcm_mulaw",
    alaw: "pcm_alaw",
};

const STT_ENCODING: Partial<Record<AudioEncoding, Cartesia.STTEncoding>> = {
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
export function toOutputFormat(requested: AudioFormat | undefined, fallback: ResolvedAudioFormat): OutputFormat {
    const container = requested?.container ?? fallback.container;
    const encoding = requested?.encoding ?? fallback.encoding;
    const sampleRate = requested?.sampleRate ?? fallback.sampleRate;
    const channels = requested?.channels ?? fallback.channels;
    const bitrate = requested?.bitrate ?? fallback.bitrate;

    if (channels !== 1) {
        throw new ValidationError("cartesia", "format.channels", `Cartesia only generates mono audio, got ${channels}.`);
    }
    if (!isSampleRate(sampleRate)) {
        throw new ValidationError(
            "cartesia",
            "format.sampleRate",
            `${sampleRate} is not supported. Supported: ${SAMPLE_RATES.join(", ")}.`,
        );
    }

    if (container === "mp3") {
        const bitRate = (bitrate ?? 128) * 1000;
        if (!isBitRate(bitRate)) {
            throw new ValidationError(
                "cartesia",
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
        throw new ValidationError("cartesia", "format.container", `"${container}" is not supported. Supported: raw, wav, mp3.`);
    }

    const rawEncoding = RAW_ENCODING[encoding];
    if (!rawEncoding) {
        throw new ValidationError(
            "cartesia",
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
): { payload: Cartesia.RawOutputFormat; resolved: ResolvedAudioFormat } {
    const { payload, resolved } = toOutputFormat(requested, fallback);
    if (payload.container !== "raw") {
        throw new ValidationError(
            "cartesia",
            "format.container",
            `Streaming synthesis only supports the "raw" container, got "${payload.container}". Use speak() for ${payload.container}.`,
        );
    }
    return { payload, resolved };
}

export function toSTTEncoding(format: AudioFormat | undefined): Cartesia.STTEncoding | undefined {
    if (!format?.encoding) return undefined;

    const encoding = STT_ENCODING[format.encoding];
    if (!encoding) {
        throw new ValidationError(
            "cartesia",
            "format.encoding",
            `"${format.encoding}" has no Cartesia equivalent. Supported: ${Object.keys(STT_ENCODING).join(", ")}.`,
        );
    }
    return encoding;
}

/** Only speed, volume and emotion have Cartesia equivalents; the rest are ignored. */
export function toGenerationConfig(controls: VoiceControls | undefined): Cartesia.GenerationConfig | undefined {
    if (!controls) return undefined;

    const config: Cartesia.GenerationConfig = {};
    if (controls.speed !== undefined) config.speed = inRange("controls.speed", controls.speed, 0.6, 1.5);
    if (controls.volume !== undefined) config.volume = inRange("controls.volume", controls.volume, 0.5, 2);
    if (controls.emotion !== undefined) config.emotion = controls.emotion as Cartesia.Emotion;

    return Object.keys(config).length > 0 ? config : undefined;
}

export function toVoice(voice: string | undefined): Cartesia.VoiceSpecifier {
    if (!voice) {
        throw new ValidationError(
            "cartesia",
            "voice",
            "A voice id is required. Pass `voice` or set `defaultVoice` on the provider.",
        );
    }
    return { mode: "id", id: voice };
}

function isSampleRate(value: number): value is SampleRate {
    return (SAMPLE_RATES as number[]).includes(value);
}

function isBitRate(value: number): value is BitRate {
    return (BIT_RATES as number[]).includes(value);
}

function inRange(field: string, value: number, min: number, max: number): number {
    if (!(value >= min && value <= max)) {
        throw new ValidationError("cartesia", field, `Expected a value between ${min} and ${max}, got ${value}.`);
    }
    return value;
}
