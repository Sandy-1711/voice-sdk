import type { Alignment, AudioFormat, ResolvedAudioFormat } from "./audio";
import type { ProviderOptions, TranscriptWord, VoiceControls } from "./types";

/**
 * A duplex, long-lived connection. `push` is fire-and-forget so a token loop
 * never awaits per token; failures surface on `output` and `closed`.
 */
export interface RealtimeSession<TIn, TEvent> {
    readonly output: AsyncIterable<TEvent>;

    push(input: TIn): void;

    /** TTS: synthesize what is buffered. STT: finalize what is buffered. */
    flush(): Promise<void>;

    /** Barge-in. Best-effort: not every provider can drop queued work. */
    cancel(): void;

    close(): Promise<void>;

    readonly closed: Promise<void>;
}

export interface RealtimeTTSInput {
    model?: string;
    voice?: string;
    language?: string;
    format?: AudioFormat;
    controls?: VoiceControls;
    timings?: boolean | Alignment["unit"];
    signal?: AbortSignal;
    providerOptions?: ProviderOptions;
}

export type TTSEvent =
    | { type: "audio"; data: Uint8Array; offset?: number }
    | { type: "timing"; alignment: Alignment }
    | { type: "flushed"; id?: string | number }
    | { type: "cleared"; id?: string | number }
    /** The current generation finished. */
    | { type: "done" }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    | { type: "warning"; message: string; code?: string };

export interface TTSSession extends RealtimeSession<string, TTSEvent> {
    readonly format: ResolvedAudioFormat;
}

/** `manual` puts turn boundaries under the caller's control, via `flush()`. */
export type TurnDetection =
    | { mode: "manual" }
    | {
        mode: "vad";
        /** Silence before a turn closes, in seconds. */
        silence?: number;
        /** Sensitivity, 0 to 1. */
        threshold?: number;
        /** Minimum speech before a turn opens, in seconds. */
        minSpeech?: number;
    };

export interface RealtimeSTTInput {
    model?: string;
    language?: string;
    /** Connection-scoped: no provider negotiates or sniffs it. */
    inputFormat?: AudioFormat;
    interimResults?: boolean;
    turnDetection?: TurnDetection;
    timestamps?: boolean;
    diarize?: boolean;
    keyterms?: string[];
    signal?: AbortSignal;
    providerOptions?: ProviderOptions;
}

/**
 * `partial` will be revised, `final` is a stable segment within a turn that may
 * continue, `turn_end` means the speaker finished.
 */
export type Finality = "partial" | "final" | "turn_end";

export interface STTTranscriptEvent {
    type: "transcript";
    finality: Finality;
    /** Cumulative text of the current turn. */
    text: string;
    /** New text since the previous event of this turn. */
    delta: string;
    turn: number;
    /** Seconds from session start. */
    start?: number;
    end?: number;
    words?: TranscriptWord[];
    language?: string;
    confidence?: number;
    endOfTurnConfidence?: number;
    raw?: unknown;
}

export type STTEvent =
    | STTTranscriptEvent
    | { type: "speech_started"; at: number }
    | { type: "speech_ended"; at: number }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    | { type: "warning"; message: string; code?: string };

export type STTSession = RealtimeSession<Uint8Array, STTEvent>;

/** The one input format every provider accepts. */
export const DEFAULT_REALTIME_INPUT_FORMAT: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
};
