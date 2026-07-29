import { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { ValidationError } from "@voice-sdk/core";
import type { AudioFormat, ResolvedAudioFormat, VoiceControls } from "@voice-sdk/core";
import { PROVIDER } from "./config";

/**
 * Translation between core's vocabulary and ElevenLabs'.
 *
 * Naming convention across every provider:
 *   to<Thing>   core  -> provider   (building a request)
 *   from<Thing> provider -> core    (reading a response)
 */

type OutputFormatValue = ElevenLabs.TextToSpeechConvertRequestOutputFormat;

const OUTPUT_FORMATS = Object.values(ElevenLabs.TextToSpeechConvertRequestOutputFormat) as string[];
const STREAM_OUTPUT_FORMATS = Object.values(ElevenLabs.TextToSpeechStreamRequestOutputFormat) as string[];

/** ElevenLabs' server default. */
export const DEFAULT_FORMAT: ResolvedAudioFormat = {
    container: "mp3",
    encoding: "mp3",
    sampleRate: 44100,
    channels: 1,
    bitrate: 128,
};

export interface OutputFormat {
    value: OutputFormatValue;
    resolved: ResolvedAudioFormat;
}

/**
 * ElevenLabs fuses container, sample rate and bitrate into one token
 * (`mp3_44100_128`, `pcm_16000`, `ulaw_8000`). Build it, then check it against
 * the values the API actually accepts.
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
            `ElevenLabs only generates mono audio, got ${channels}.`,
        );
    }

    const { value, resolved } = build({ container, encoding, sampleRate, bitrate });

    if (!OUTPUT_FORMATS.includes(value)) {
        const family = value.slice(0, value.indexOf("_") + 1);
        throw new ValidationError(
            PROVIDER,
            "format",
            `"${value}" is not supported. Supported: ${OUTPUT_FORMATS.filter((f) => f.startsWith(family)).join(", ")}.`,
        );
    }

    return { value: value as OutputFormatValue, resolved: { ...resolved, channels: 1 } };
}

/**
 * The streaming endpoints accept everything except `wav`, since a wav header
 * declares a length that is not known until generation ends.
 */
export function toStreamOutputFormat(
    requested: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { value: ElevenLabs.TextToSpeechStreamRequestOutputFormat; resolved: ResolvedAudioFormat } {
    const { value, resolved } = toOutputFormat(requested, fallback);

    if (!STREAM_OUTPUT_FORMATS.includes(value)) {
        throw new ValidationError(
            PROVIDER,
            "format.container",
            `"${value}" cannot be streamed. Use speak() for ${resolved.container}, or stream mp3, opus, pcm, ulaw or alaw.`,
        );
    }
    return { value: value as ElevenLabs.TextToSpeechStreamRequestOutputFormat, resolved };
}

function build(format: Required<Pick<ResolvedAudioFormat, "container" | "encoding" | "sampleRate">> & { bitrate?: number }) {
    const { container, encoding, sampleRate, bitrate } = format;

    switch (container) {
        case "mp3":
            return {
                value: `mp3_${sampleRate}_${bitrate ?? 128}`,
                resolved: { container, encoding: "mp3", sampleRate, bitrate: bitrate ?? 128 } as ResolvedAudioFormat,
            };
        case "wav":
            // ElevenLabs' wav is always signed 16-bit PCM.
            return {
                value: `wav_${sampleRate}`,
                resolved: { container, encoding: "pcm_s16le", sampleRate } as ResolvedAudioFormat,
            };
        case "ogg":
        case "webm":
            return {
                value: `opus_${sampleRate}_${bitrate ?? 64}`,
                resolved: { container: "ogg", encoding: "opus", sampleRate, bitrate: bitrate ?? 64 } as ResolvedAudioFormat,
            };
        case "raw":
            return { value: `${rawPrefix(encoding)}_${sampleRate}`, resolved: { container, encoding, sampleRate } as ResolvedAudioFormat };
        default:
            throw new ValidationError(
                PROVIDER,
                "format.container",
                `"${container}" is not supported. Supported: mp3, wav, ogg, raw.`,
            );
    }
}

/** Headerless output is named by its codec, and ElevenLabs spells mu-law `ulaw`. */
function rawPrefix(encoding: ResolvedAudioFormat["encoding"]): string {
    switch (encoding) {
        case "pcm_s16le":
            return "pcm";
        case "mulaw":
            return "ulaw";
        case "alaw":
            return "alaw";
        default:
            throw new ValidationError(
                PROVIDER,
                "format.encoding",
                `"${encoding}" has no ElevenLabs equivalent. Supported: pcm_s16le, mulaw, alaw.`,
            );
    }
}

/** Only these four have ElevenLabs equivalents; the rest are ignored. */
export function toVoiceSettings(controls: VoiceControls | undefined): ElevenLabs.VoiceSettings | undefined {
    if (!controls) return undefined;

    const settings: ElevenLabs.VoiceSettings = {};
    if (controls.speed !== undefined) settings.speed = controls.speed;
    if (controls.stability !== undefined) settings.stability = controls.stability;
    if (controls.similarity !== undefined) settings.similarityBoost = controls.similarity;
    if (controls.style !== undefined) settings.style = controls.style;

    return Object.keys(settings).length > 0 ? settings : undefined;
}
