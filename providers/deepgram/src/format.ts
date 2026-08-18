import { ValidationError } from "@swungstudent/voice";
import type {
    AudioEncoding,
    AudioFormat,
    ResolvedAudioFormat,
    SpeakInput,
    TranscriptWord,
    VoiceControls,
} from "@swungstudent/voice";
import { PROVIDER } from "./config";

/**
 * Translation between core's vocabulary and Deepgram's.
 *
 * Naming convention across every provider:
 *   to<Thing>   core  -> provider   (building a request)
 *   from<Thing> provider -> core    (reading a response)
 */

/** Query params for `/v1/speak`, batch and realtime alike. */
export interface OutputParams {
    encoding: string;
    container?: string;
    sample_rate?: number;
    bit_rate?: number;
}

export interface OutputFormat {
    params: OutputParams;
    resolved: ResolvedAudioFormat;
}

/** The only rates `/v1/speak` accepts on its `sample_rate` param. */
const SAMPLE_RATES = [8000, 16000, 24000, 32000, 48000];

/**
 * Headerless output, named by codec. Deepgram spells 16-bit PCM `linear16` and,
 * unlike Cartesia, does not prefix the telephony codecs.
 */
const RAW_ENCODING: Partial<Record<AudioEncoding, string>> = {
    pcm_s16le: "linear16",
    mulaw: "mulaw",
    alaw: "alaw",
};

/** What `WSS /v1/speak` accepts, which is narrower than the REST endpoint. */
const REALTIME_ENCODINGS = ["linear16", "mulaw", "alaw"];

/** Deepgram names the input codec for headerless audio only. */
const STT_ENCODING: Partial<Record<AudioEncoding, string>> = {
    pcm_s16le: "linear16",
    pcm_s32le: "linear32",
    mulaw: "mulaw",
    alaw: "alaw",
    flac: "flac",
    opus: "opus",
};

/**
 * Lowers a requested format onto Deepgram's `encoding` + `container` +
 * `sample_rate` triple. Throws rather than substituting, since the wrong
 * encoding produces unplayable bytes.
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
            `Deepgram only generates mono audio, got ${channels}.`,
        );
    }
    if (!SAMPLE_RATES.includes(sampleRate)) {
        throw new ValidationError(
            PROVIDER,
            "format.sampleRate",
            `${sampleRate} is not supported. Supported: ${SAMPLE_RATES.join(", ")}.`,
        );
    }

    const bitRate = bitrate === undefined ? undefined : bitrate * 1000;

    switch (container) {
        // Deepgram calls the absence of a container "none".
        case "raw":
            return {
                params: { encoding: toRawEncoding(encoding), container: "none", sample_rate: sampleRate },
                resolved: { container, encoding, sampleRate, channels: 1 },
            };

        case "wav":
            return {
                params: { encoding: toRawEncoding(encoding), container: "wav", sample_rate: sampleRate },
                resolved: { container, encoding, sampleRate, channels: 1 },
            };

        // mp3, flac and aac are self-framing, so they ride the "none" container.
        case "mp3":
            return {
                params: { encoding: "mp3", container: "none", sample_rate: sampleRate, bit_rate: bitRate },
                resolved: { container, encoding: "mp3", sampleRate, channels: 1, bitrate },
            };

        case "flac":
            return {
                params: { encoding: "flac", container: "none", sample_rate: sampleRate },
                resolved: { container, encoding: "flac", sampleRate, channels: 1 },
            };

        case "aac":
            return {
                params: { encoding: "aac", container: "none", sample_rate: sampleRate, bit_rate: bitRate },
                resolved: { container, encoding: "aac", sampleRate, channels: 1, bitrate },
            };

        case "ogg":
            return {
                params: { encoding: "opus", container: "ogg", sample_rate: sampleRate, bit_rate: bitRate },
                resolved: { container, encoding: "opus", sampleRate, channels: 1, bitrate },
            };

        default:
            throw new ValidationError(
                PROVIDER,
                "format.container",
                `"${container}" is not supported. Supported: raw, wav, mp3, ogg, flac, aac.`,
            );
    }
}

/**
 * The synthesis WebSocket only emits headerless PCM, mu-law or A-law, and it
 * takes no `container` param at all — sending one is a handshake error.
 */
export function toRealtimeOutputFormat(
    requested: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { params: { encoding: string; sample_rate?: number }; resolved: ResolvedAudioFormat } {
    const { params, resolved } = toOutputFormat(requested, fallback);

    if (resolved.container !== "raw") {
        throw new ValidationError(
            PROVIDER,
            "format.container",
            `Streaming synthesis only supports the "raw" container, got "${resolved.container}". Use speak() for ${resolved.container}.`,
        );
    }
    if (!REALTIME_ENCODINGS.includes(params.encoding)) {
        throw new ValidationError(
            PROVIDER,
            "format.encoding",
            `"${resolved.encoding}" cannot be streamed. Supported: ${Object.keys(RAW_ENCODING).join(", ")}.`,
        );
    }
    return { params: { encoding: params.encoding, sample_rate: params.sample_rate }, resolved };
}

function toRawEncoding(encoding: AudioEncoding): string {
    const raw = RAW_ENCODING[encoding];
    if (!raw) {
        throw new ValidationError(
            PROVIDER,
            "format.encoding",
            `"${encoding}" has no Deepgram equivalent. Supported: ${Object.keys(RAW_ENCODING).join(", ")}.`,
        );
    }
    return raw;
}

/**
 * Deepgram sniffs containerized audio, so `encoding` is sent only for
 * headerless input — passing it alongside a wav or mp3 header makes Deepgram
 * read the header as samples.
 */
export function toSTTFormat(format: AudioFormat | undefined): { encoding?: string; sample_rate?: number } {
    if (!format?.encoding) return {};

    const headerless = format.container === "raw" || format.container === undefined;
    if (!headerless) return {};

    const encoding = toSTTEncoding(format.encoding);
    if (format.sampleRate === undefined) {
        throw new ValidationError(
            PROVIDER,
            "format.sampleRate",
            `Headerless "${format.encoding}" audio needs a sample rate — Deepgram cannot infer one without a container.`,
        );
    }
    return { encoding, sample_rate: format.sampleRate };
}

/** Realtime STT has nothing to sniff, so both fields are connection-time required. */
export function toRealtimeSTTFormat(
    format: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { encoding: string; sample_rate: number } {
    return {
        encoding: toSTTEncoding(format?.encoding ?? fallback.encoding),
        sample_rate: format?.sampleRate ?? fallback.sampleRate,
    };
}

function toSTTEncoding(encoding: AudioEncoding): string {
    const mapped = STT_ENCODING[encoding];
    if (!mapped) {
        throw new ValidationError(
            PROVIDER,
            "format.encoding",
            `"${encoding}" has no Deepgram equivalent. Supported: ${Object.keys(STT_ENCODING).join(", ")}.`,
        );
    }
    return mapped;
}

/**
 * Only speed has a Deepgram equivalent, and Deepgram documents no range for it,
 * so the value passes through unchecked. `volume`, `stability`, `similarity`,
 * `style`, `emotion` and `instructions` are ignored.
 */
export function toSpeed(controls: VoiceControls | undefined): number | undefined {
    return controls?.speed;
}

/**
 * Deepgram synthesis reports no timings at any granularity. Asking for them and
 * silently getting audio with no alignment is worth an error rather than a
 * surprise on the far side.
 */
export function assertNoTimings(timings: SpeakInput["timings"]): void {
    if (!timings) return;

    throw new ValidationError(
        PROVIDER,
        "timings",
        `"${timings}" is not supported. Deepgram synthesis reports no timings — use Cartesia or ElevenLabs if you need them.`,
    );
}

export interface WireWord {
    word?: string;
    start?: number;
    end?: number;
    confidence?: number;
    punctuated_word?: string;
    speaker?: number;
    language?: string;
}

export function fromWords(words: WireWord[] | undefined): TranscriptWord[] | undefined {
    if (!words || words.length === 0) return undefined;

    return words.map((word) => ({
        text: word.word ?? "",
        start: word.start ?? 0,
        end: word.end ?? 0,
        confidence: word.confidence,
        punctuated: word.punctuated_word,
        // Deepgram numbers its speakers, and speaker 0 is a real speaker.
        speaker: word.speaker === undefined ? undefined : String(word.speaker),
    }));
}
