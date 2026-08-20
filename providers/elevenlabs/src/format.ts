import { collectAudio, ValidationError } from "@swungstudent/voice";
import type {
    Alignment,
    AudioFormat,
    AudioSource,
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

/**
 * The API's own vocabulary, which used to arrive as generated enums. Kept as
 * plain arrays so the whole 22 MB client is not a dependency of four constants.
 */
export const OUTPUT_FORMATS = [
    "alaw_8000",
    "mp3_22050_32", "mp3_24000_48", "mp3_44100_32", "mp3_44100_64",
    "mp3_44100_96", "mp3_44100_128", "mp3_44100_192",
    "opus_48000_32", "opus_48000_64", "opus_48000_96", "opus_48000_128", "opus_48000_192",
    "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_32000", "pcm_44100", "pcm_48000",
    "ulaw_8000",
    "wav_8000", "wav_16000", "wav_22050", "wav_24000", "wav_32000", "wav_44100", "wav_48000",
] as const;

export type OutputFormatValue = (typeof OUTPUT_FORMATS)[number];

/** Widened, so a built token can be checked against the list before it is one. */
const SUPPORTED: readonly string[] = OUTPUT_FORMATS;

/** Everything except wav, whose header declares a length generation has not reached. */
const STREAM_SUPPORTED: readonly string[] = OUTPUT_FORMATS.filter((value) => !value.startsWith("wav_"));

export type StreamOutputFormatValue = OutputFormatValue;

/** Only the fields core's `VoiceControls` can reach. */
export interface VoiceSettings {
    speed?: number;
    stability?: number;
    similarityBoost?: number;
    style?: number;
}

export type FileFormat = "pcm_s16le_16" | "other";
export type TimestampsGranularity = "none" | "word" | "character";

export interface WordResponse {
    text: string;
    start?: number;
    end?: number;
    /** A log probability in [-inf, 0], not a 0-1 confidence. */
    logprob: number;
    type?: TranscriptWord["kind"];
    speakerId?: string;
}

export interface CharacterAlignment {
    characters: string[];
    characterStartTimesSeconds: number[];
    characterEndTimesSeconds: number[];
}

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

    if (!SUPPORTED.includes(value)) {
        const family = value.slice(0, value.indexOf("_") + 1);
        throw new ValidationError(
            PROVIDER,
            "format",
            `"${value}" is not supported. Supported: ${SUPPORTED.filter((f) => f.startsWith(family)).join(", ")}.`,
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
): { value: StreamOutputFormatValue; resolved: ResolvedAudioFormat } {
    const { value, resolved } = toOutputFormat(requested, fallback);

    if (!STREAM_SUPPORTED.includes(value)) {
        throw new ValidationError(
            PROVIDER,
            "format.container",
            `"${value}" cannot be streamed. Use speak() for ${resolved.container}, or stream mp3, opus, pcm, ulaw or alaw.`,
        );
    }
    return { value, resolved };
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
export function toVoiceSettings(controls: VoiceControls | undefined): VoiceSettings | undefined {
    if (!controls) return undefined;

    const settings: VoiceSettings = {};
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
): FileFormat | undefined {
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
): TimestampsGranularity {
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

/** `logprob` is a log probability in [-inf, 0], not a 0-1 confidence. */
export function fromWord(word: WordResponse): TranscriptWord {
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
    alignment: CharacterAlignment | undefined,
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
