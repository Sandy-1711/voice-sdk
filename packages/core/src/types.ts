import type { Alignment, AudioFormat, AudioSource, ResolvedAudioFormat } from "./audio";

export interface RequestContext {
    signal?: AbortSignal;
    /** Per-request timeout in milliseconds. */
    timeout?: number;
    retries?: number;
}

export type ProviderOptions = Record<string, unknown>;

/**
 * Prosody knobs. Best-effort: a provider with no equivalent ignores the field
 * rather than throwing, since the result is still usable audio.
 */
export interface VoiceControls {
    /** Rate multiplier, 1 = normal. */
    speed?: number;
    /** Gain multiplier, 1 = normal. */
    volume?: number;
    stability?: number;
    similarity?: number;
    style?: number;
    emotion?: string;
    /** Free-text style direction. */
    instructions?: string;
}

export interface SpeakInput {
    text: string;
    model?: string;
    voice?: string;
    language?: string;
    format?: AudioFormat;
    controls?: VoiceControls;
    timings?: boolean | Alignment["unit"];
    providerOptions?: ProviderOptions;
}

export interface SpeakResult {
    audio: Uint8Array;
    format: ResolvedAudioFormat;
    alignment?: Alignment;
    requestId?: string;
    raw?: unknown;
}

export interface TranscribeInput {
    audio: AudioSource;
    model?: string;
    language?: string;
    /** Required when the audio is headerless PCM. */
    format?: AudioFormat;
    timestamps?: false | "word" | "segment" | "character";
    diarize?: boolean;
    speakerCount?: number;
    keyterms?: string[];
    prompt?: string;
    providerOptions?: ProviderOptions;
}

export interface TranscriptWord {
    text: string;
    /** Seconds. */
    start: number;
    /** Seconds. */
    end: number;
    confidence?: number;
    speaker?: string;
    punctuated?: string;
    kind?: "word" | "spacing" | "audio_event";
}

export interface TranscriptSegment {
    text: string;
    start: number;
    end: number;
    speaker?: string;
    confidence?: number;
}

export interface TranscriptResult {
    text: string;
    language?: string;
    languageConfidence?: number;
    /** Audio length in seconds. */
    duration?: number;
    confidence?: number;
    words?: TranscriptWord[];
    segments?: TranscriptSegment[];
    requestId?: string;
    raw?: unknown;
}
