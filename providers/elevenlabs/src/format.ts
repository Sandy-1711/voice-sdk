import { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { collectAudio, ValidationError } from "@swungstudent/voice";
import type {
    Alignment,
    AudioFormat,
    AudioSource,
    RequestContext,
    ResolvedAudioFormat,
    SpeakInput,
    TranscribeInput,
    TranscriptWord,
    VoiceControls,
} from "@swungstudent/voice";
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

/** ElevenLabs takes a URL natively, so skip the round trip when given one. */
export async function toSource(audio: AudioSource) {
    if ("url" in audio) return { sourceUrl: audio.url };
    return { file: await collectAudio(audio) };
}

/**
 * ElevenLabs only distinguishes "raw 16-bit PCM at 16 kHz" from "an encoded
 * waveform it can sniff", and the raw path is lower latency. Any other
 * headerless format would be sniffed and fail, so it is rejected here.
 */
export function toFileFormat(
    format: AudioFormat | undefined,
): ElevenLabs.SpeechToTextConvertRequestFileFormat | undefined {
    if (!format) return undefined;

    const headerless = format.container === "raw" || (!format.container && isRawEncoding(format.encoding));
    if (!headerless) return "other";

    if (format.encoding === "pcm_s16le" && (format.sampleRate ?? 16000) === 16000 && (format.channels ?? 1) === 1) {
        return "pcm_s16le_16";
    }
    throw new ValidationError(
        PROVIDER,
        "format",
        "Headerless audio must be 16-bit PCM at 16 kHz mono. Use a container format (wav, mp3, ...) for anything else.",
    );
}

const GRANULARITY = {
    word: "word",
    character: "character",
} as const;

export function toGranularity(
    timestamps: TranscribeInput["timestamps"],
): ElevenLabs.SpeechToTextConvertRequestTimestampsGranularity {
    if (!timestamps) return "none";

    const granularity = GRANULARITY[timestamps as keyof typeof GRANULARITY];
    if (!granularity) {
        throw new ValidationError(
            PROVIDER,
            "timestamps",
            `"${timestamps}" is not supported. Supported: ${Object.keys(GRANULARITY).join(", ")}.`,
        );
    }
    return granularity;
}

/** ElevenLabs aligns per character, so word and phoneme requests cannot be met. */
export function assertCharacterTimings(timings: NonNullable<SpeakInput["timings"]>): void {
    if (timings !== true && timings !== "character") {
        throw new ValidationError(
            PROVIDER,
            "timings",
            `"${timings}" is not supported. ElevenLabs reports character-level timings only.`,
        );
    }
}

export function toRequestOptions(context?: RequestContext) {
    return {
        abortSignal: context?.signal,
        // Core counts timeouts in milliseconds, ElevenLabs in seconds.
        timeoutInSeconds: context?.timeout === undefined ? undefined : context.timeout / 1000,
        maxRetries: context?.retries,
    };
}

/** `logprob` is a log probability in [-inf, 0], not a 0-1 confidence. */
export function fromWord(word: ElevenLabs.SpeechToTextWordResponseModel): TranscriptWord {
    return {
        text: word.text,
        start: word.start ?? 0,
        end: word.end ?? 0,
        confidence: Math.exp(word.logprob),
        speaker: word.speakerId,
        kind: word.type,
    };
}

export function fromAlignment(
    alignment: ElevenLabs.CharacterAlignmentResponseModel | undefined,
): Alignment | undefined {
    if (!alignment) return undefined;

    return {
        unit: "character",
        spans: alignment.characters.map((text, index) => ({
            text,
            start: alignment.characterStartTimesSeconds[index] ?? 0,
            end: alignment.characterEndTimesSeconds[index] ?? 0,
        })),
    };
}

/** Realtime STT names its input format the same way TTS names its output. */
export function toRealtimeAudioFormat(format: AudioFormat | undefined): string {
    const encoding = format?.encoding ?? "pcm_s16le";
    const sampleRate = format?.sampleRate ?? 16000;

    if (encoding === "mulaw") return "ulaw_8000";
    if (encoding === "pcm_s16le") return `pcm_${sampleRate}`;

    throw new ValidationError(
        PROVIDER,
        "inputFormat.encoding",
        `"${encoding}" is not supported. Supported: pcm_s16le, mulaw.`,
    );
}

/**
 * The TTS WebSocket reports alignment in milliseconds as start + duration,
 * unlike the REST endpoints which already report seconds.
 */
export function fromWsAlignment(alignment: WsAlignment | undefined): Alignment | undefined {
    if (!alignment) return undefined;

    return {
        unit: "character",
        spans: alignment.chars.map((text, index) => {
            const start = (alignment.charStartTimesMs[index] ?? 0) / 1000;
            return { text, start, end: start + (alignment.charDurationsMs[index] ?? 0) / 1000 };
        }),
    };
}

export interface WsAlignment {
    chars: string[];
    charStartTimesMs: number[];
    charDurationsMs: number[];
}

function isRawEncoding(encoding: AudioFormat["encoding"]): boolean {
    return encoding === "pcm_s16le" || encoding === "pcm_s32le" || encoding === "pcm_f32le"
        || encoding === "mulaw" || encoding === "alaw";
}
