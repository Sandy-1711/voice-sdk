/**
 * Draft core type surface for @swungstudent/voice.
 *
 * Derived from the provider survey in ./provider-research.md (ElevenLabs,
 * Deepgram, Cartesia, OpenAI — plus AssemblyAI/Groq as stress tests).
 *
 * Design rules this file follows, in priority order:
 *
 *  1. **Lossless for the common path.** Anything two or more providers emit
 *     gets a named field. Anything only one provider emits lives in `raw` /
 *     `providerOptions` rather than bloating the shared shape.
 *  2. **One vocabulary, one unit.** All times are **seconds** (floats), all
 *     audio is `Uint8Array`, all base64 is decoded by the provider before it
 *     reaches core. Providers that speak ms (AssemblyAI, ElevenLabs alignment)
 *     convert on the way out.
 *  3. **Streams are events, not bytes.** Realtime surfaces emit discriminated
 *     unions so `flush`/`cancel` acks, timings and VAD signals survive. Byte
 *     -only consumers use the `audioOnly()` helper.
 *  4. **Fail loudly on unrepresentable audio, quietly on unrepresentable
 *     style.** A wrong `encoding` produces garbage bytes, so it throws. An
 *     ignored `stability` produces slightly different prosody, so it warns.
 *  5. **Escape hatches both ways.** `providerOptions` in, `raw` out. Neither
 *     is ever required to use the SDK.
 *
 * Not wired into src/ yet — see the migration note at the bottom.
 */

// ---------------------------------------------------------------------------
// 1. Audio primitives
// ---------------------------------------------------------------------------

/**
 * Sample-level encoding. Deliberately spells out endianness/width because
 * `pcm_s16le` and `pcm_f32le` are not interchangeable when the bytes reach a
 * speaker or a phone line.
 */
export type AudioEncoding =
    | "pcm_s16le"
    | "pcm_s32le"
    | "pcm_f32le"
    | "mulaw"
    | "alaw"
    | "mp3"
    | "opus"
    | "aac"
    | "flac";

/** Byte framing around the samples. `raw` = headerless. */
export type AudioContainer =
    | "raw"
    | "wav"
    | "mp3"
    | "ogg"
    | "webm"
    | "flac"
    | "aac";

/**
 * A *requested* format. Every field optional: providers differ in what is
 * selectable (OpenAI cannot choose a sample rate; Deepgram cannot choose a
 * container). Unset fields mean "provider default".
 */
export interface AudioFormat {
    container?: AudioContainer;
    encoding?: AudioEncoding;
    /** Hz. */
    sampleRate?: number;
    /** Defaults to 1 everywhere in practice. */
    channels?: number;
    /** kbps — only meaningful for mp3/opus/aac. */
    bitrate?: number;
}

/**
 * The format actually in effect. Always reported back so a caller knows how to
 * play the bytes without re-deriving it from the request.
 */
export interface ResolvedAudioFormat extends AudioFormat {
    container: AudioContainer;
    encoding: AudioEncoding;
    sampleRate: number;
    channels: number;
}

/**
 * Batch audio input. The `{ url }` member exists because AssemblyAI accepts
 * *only* a URL and ElevenLabs accepts `source_url`; providers that need bytes
 * fetch it, providers that need a URL upload first. Either way the caller
 * doesn't care.
 */
export type AudioSource =
    | Uint8Array
    | ArrayBuffer
    | Blob
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>
    | { url: string };

/** One frame of generated or captured audio. */
export interface AudioChunk {
    data: Uint8Array;
    /** Seconds from the start of the stream, when the provider reports it. */
    offset?: number;
    /** Correlates the chunk with a generation context (see `TTSSession`). */
    contextId?: string;
}

/** An audio stream that knows its own format up front. */
export interface AudioStream extends AsyncIterable<AudioChunk> {
    readonly format: ResolvedAudioFormat;
}

// ---------------------------------------------------------------------------
// 2. Timing
// ---------------------------------------------------------------------------

/** A span of text with its position in the audio, in seconds. */
export interface TimingSpan {
    text: string;
    start: number;
    end: number;
}

/**
 * Normalized alignment. Cartesia returns parallel arrays at word or phoneme
 * granularity; ElevenLabs returns character arrays in milliseconds. Both
 * collapse to this.
 */
export interface Alignment {
    unit: "word" | "character" | "phoneme";
    spans: TimingSpan[];
}

// ---------------------------------------------------------------------------
// 3. Voice controls
// ---------------------------------------------------------------------------

/**
 * Prosody knobs, normalized. Every field is best-effort: a provider that has
 * no equivalent **ignores it and warns** rather than throwing, because the
 * result is still usable audio. Contrast with `AudioFormat`, where a mismatch
 * produces unplayable bytes and therefore throws.
 */
export interface VoiceControls {
    /** Rate multiplier, 1 = normal. Clamped per provider (Cartesia 0.6–1.5). */
    speed?: number;
    /** Gain multiplier, 1 = normal. Cartesia only. */
    volume?: number;
    /** 0–1. ElevenLabs `stability`. */
    stability?: number;
    /** 0–1. ElevenLabs `similarity_boost`. */
    similarity?: number;
    /** 0–1. ElevenLabs `style`. */
    style?: number;
    /** Named affect. Cartesia: neutral | calm | angry | content | sad. */
    emotion?: string;
    /** Free-text style direction. OpenAI `instructions` — no one else has it. */
    instructions?: string;
}

// ---------------------------------------------------------------------------
// 4. Request context
// ---------------------------------------------------------------------------

export interface RequestContext {
    signal?: AbortSignal;
    /** Per-request timeout in ms. */
    timeout?: number;
    /** Retry attempts for retryable failures. */
    retries?: number;
}

/** Untyped by default; see "typed provider options" in ./type-design.md. */
export type ProviderOptions = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 5. Batch TTS  —  text in, audio out
// ---------------------------------------------------------------------------

export interface SpeakInput {
    text: string;
    /** Provider model id. Falls back to the provider's configured default. */
    model?: string;
    /** Provider voice id. Falls back to the provider's configured default. */
    voice?: string;
    /** BCP-47 / ISO-639-1 hint. */
    language?: string;
    format?: AudioFormat;
    controls?: VoiceControls;
    /**
     * Ask for word/character timings alongside the audio. Only ElevenLabs
     * (`/with-timestamps`) and Cartesia (`add_timestamps`) can honour it.
     */
    timings?: boolean | Alignment["unit"];
    providerOptions?: ProviderOptions;
}

export interface SpeakResult {
    audio: Uint8Array;
    format: ResolvedAudioFormat;
    /** Present only when `timings` was requested and supported. */
    alignment?: Alignment;
    /** Provider-side id, for support tickets and log correlation. */
    requestId?: string;
    /** Untouched provider payload. */
    raw?: unknown;
}

// ---------------------------------------------------------------------------
// 6. Batch STT  —  audio in, transcript out
// ---------------------------------------------------------------------------

export interface TranscribeInput {
    audio: AudioSource;
    model?: string;
    language?: string;
    /**
     * Required when `audio` is headerless PCM; ignored for container formats
     * the provider can sniff (wav/mp3/ogg/...).
     */
    format?: AudioFormat;
    /** `false` (default) | "word" | "segment" | "character". */
    timestamps?: false | "word" | "segment" | "character";
    /** Speaker attribution. Populates `TranscriptWord.speaker`. */
    diarize?: boolean;
    /** Expected speaker count, when the provider can use the hint. */
    speakerCount?: number;
    /** Domain terms to bias recognition toward. */
    keyterms?: string[];
    /** Context/priming text. OpenAI + Groq cap this at 224 tokens. */
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
    /** Present when diarization is on. */
    speaker?: string;
    /** Deepgram `punctuated_word`, when it differs from `text`. */
    punctuated?: string;
    /**
     * ElevenLabs distinguishes real words from spacing and tagged audio events
     * (laughter, etc.). Absent means "word".
     */
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
    /** 0–1 detection confidence, where the provider reports one. */
    languageConfidence?: number;
    /** Audio length in seconds. */
    duration?: number;
    confidence?: number;
    words?: TranscriptWord[];
    segments?: TranscriptSegment[];
    requestId?: string;
    raw?: unknown;
}

// ---------------------------------------------------------------------------
// 7. Realtime sessions — shared shape
// ---------------------------------------------------------------------------

/**
 * A duplex, long-lived connection. `push` is fire-and-forget so an LLM token
 * loop never awaits per token; the provider buffers internally and surfaces
 * transport failures by rejecting `output` and `closed`.
 */
export interface RealtimeSession<TIn, TEvent> {
    /**
     * Single-consumer event stream. Ends when the peer closes; rejects on a
     * fatal transport or protocol error.
     */
    readonly output: AsyncIterable<TEvent>;

    /** Enqueue input. Never throws — errors surface on `output`. */
    push(input: TIn): void;

    /**
     * Force the provider to act on what it has buffered.
     *  - TTS: synthesize the buffered text now (Deepgram `Flush`,
     *    Cartesia `flush`, ElevenLabs `flush: true`).
     *  - STT: finalize the buffered audio now (Deepgram `Finalize`,
     *    Cartesia `finalize`, OpenAI `input_audio_buffer.commit`).
     *
     * Resolves when the provider acks, or immediately for providers that
     * don't ack.
     */
    flush(): Promise<void>;

    /**
     * Barge-in: discard queued work. **Best-effort** — Deepgram `Clear` and
     * Cartesia `cancel` truly drop queued audio; ElevenLabs has no cancel and
     * the provider reconnects instead. The session stays usable either way.
     */
    cancel(): void;

    /** Graceful shutdown. Resolves once the peer has closed. */
    close(): Promise<void>;

    /** Resolves on clean close, rejects on fatal error. */
    readonly closed: Promise<void>;
}

// ---------------------------------------------------------------------------
// 8. Realtime TTS  —  streamed text in, streamed audio out
// ---------------------------------------------------------------------------

export interface RealtimeTTSInput {
    model?: string;
    voice?: string;
    language?: string;
    /** Connection-scoped: it becomes a query param on every provider. */
    format?: AudioFormat;
    controls?: VoiceControls;
    /** Emit `timing` events alongside audio, where supported. */
    timings?: boolean | Alignment["unit"];
    signal?: AbortSignal;
    providerOptions?: ProviderOptions;
}

export type TTSEvent =
    /** A frame of synthesized audio. */
    | { type: "audio"; data: Uint8Array; offset?: number; contextId?: string }
    /** Word/char timings for audio already emitted. */
    | { type: "timing"; alignment: Alignment; contextId?: string }
    /** Ack for `flush()`. `id` is Deepgram's `sequence_id` / Cartesia's `flush_id`. */
    | { type: "flushed"; id?: string | number; contextId?: string }
    /** Ack for `cancel()`. */
    | { type: "cleared"; id?: string | number; contextId?: string }
    /** The current generation finished — ElevenLabs `isFinal`, Cartesia `done`. */
    | { type: "done"; contextId?: string }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    /** Non-fatal. Fatal problems reject `output` instead. */
    | { type: "warning"; message: string; code?: string };

export interface TTSSession extends RealtimeSession<string, TTSEvent> {
    /** Known at connect time, so callers can configure playback before audio. */
    readonly format: ResolvedAudioFormat;
}

// ---------------------------------------------------------------------------
// 9. Realtime STT  —  streamed audio in, streamed transcript out
// ---------------------------------------------------------------------------

/**
 * How turn boundaries get decided.
 *  - `manual`: the caller drives boundaries with `flush()`. The only mode
 *    Cartesia `ink-whisper` supports, since it has no built-in endpointing.
 *  - `vad`: the provider detects them.
 */
export type TurnDetection =
    | { mode: "manual" }
    | {
        mode: "vad";
        /** Silence before a turn is closed. Deepgram `endpointing`/`utterance_end_ms`. */
        silence?: number;
        /** 0–1 sensitivity. ElevenLabs `vad_threshold`, Deepgram Flux `eot_threshold`. */
        threshold?: number;
        /** Minimum speech before a turn opens, in seconds. */
        minSpeech?: number;
    };

export interface RealtimeSTTInput {
    model?: string;
    language?: string;
    /**
     * Connection-scoped and effectively required: every provider takes it as a
     * query param at handshake and none of them sniff. Core defaults to
     * `{ encoding: "pcm_s16le", sampleRate: 16000, channels: 1 }`.
     */
    inputFormat?: AudioFormat;
    /** Emit `partial` events. Off = only `final`/`turn_end`. */
    interimResults?: boolean;
    turnDetection?: TurnDetection;
    /** Attach word timings to transcript events. */
    timestamps?: boolean;
    diarize?: boolean;
    keyterms?: string[];
    signal?: AbortSignal;
    providerOptions?: ProviderOptions;
}

/**
 * Three states, because `boolean` is lossy — providers distinguish "this
 * segment won't change" from "the speaker stopped talking", and voice agents
 * need the second one to decide when to respond.
 */
export type Finality =
    /** Interim hypothesis; will be revised. */
    | "partial"
    /** This segment is stable and won't change. More may follow in this turn. */
    | "final"
    /** Endpoint/turn boundary — the speaker finished. */
    | "turn_end";

export interface STTTranscriptEvent {
    type: "transcript";
    finality: Finality;
    /** Cumulative text of the current turn. Always populated. */
    text: string;
    /** Only what's new since the previous event of this turn. Always populated. */
    delta: string;
    /** Monotonic turn counter, starting at 0. */
    turn: number;
    /** Seconds, relative to session start. */
    start?: number;
    end?: number;
    words?: TranscriptWord[];
    language?: string;
    confidence?: number;
    /** 0–1, on providers that score turn boundaries (Flux, AssemblyAI). */
    endOfTurnConfidence?: number;
    raw?: unknown;
}

export type STTEvent =
    | STTTranscriptEvent
    /** VAD: speech began. Seconds from session start. */
    | { type: "speech_started"; at: number }
    /** VAD: speech stopped. Deepgram `UtteranceEnd`, OpenAI `speech_stopped`. */
    | { type: "speech_ended"; at: number }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    | { type: "warning"; message: string; code?: string };

export type STTSession = RealtimeSession<Uint8Array, STTEvent>;

// ---------------------------------------------------------------------------
// 10. Provider contract
// ---------------------------------------------------------------------------

export type CapabilityName = "tts" | "stt" | "realtimeTTS" | "realtimeSTT";

export interface Capabilities {
    /** One-shot synthesis and HTTP output streaming. */
    tts: boolean;
    /** Batch transcription of complete audio. */
    stt: boolean;
    /** Duplex session: incremental text in, audio out. */
    realtimeTTS: boolean;
    /** Duplex session: audio frames in, incremental transcripts out. */
    realtimeSTT: boolean;
}

export interface VoiceInfo {
    id: string;
    name?: string;
    language?: string;
    labels?: Record<string, string>;
    previewUrl?: string;
}

/**
 * Invariant: if a capability flag is `true`, its method(s) must be present.
 * Worth asserting at construction so a misconfigured provider fails at
 * startup rather than mid-call.
 */
export interface VoiceProvider {
    readonly name: string;
    readonly capabilities: Readonly<Capabilities>;

    /** `tts` */
    speak?(input: SpeakInput, context?: RequestContext): Promise<SpeakResult>;
    speakStream?(input: SpeakInput, context?: RequestContext): AudioStream;

    /** `stt` */
    transcribe?(
        input: TranscribeInput,
        context?: RequestContext,
    ): Promise<TranscriptResult>;

    /** `realtimeTTS` */
    openTTSSession?(input?: RealtimeTTSInput): Promise<TTSSession>;

    /** `realtimeSTT` */
    openSTTSession?(input?: RealtimeSTTInput): Promise<STTSession>;

    listVoices?(): Promise<VoiceInfo[]>;
    close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 11. Helpers core should ship
// ---------------------------------------------------------------------------

/** Drop everything but the bytes, for callers that just want to play audio. */
export async function* audioOnly(
    events: AsyncIterable<TTSEvent>,
): AsyncIterable<Uint8Array> {
    for await (const event of events) {
        if (event.type === "audio") yield event.data;
    }
}

/** Keep only the events that close a turn — the voice-agent trigger. */
export async function* turns(
    events: AsyncIterable<STTEvent>,
): AsyncIterable<STTTranscriptEvent> {
    for await (const event of events) {
        if (event.type === "transcript" && event.finality === "turn_end") {
            yield event;
        }
    }
}

/**
 * Providers emit whichever of delta/cumulative their wire format gives; this
 * fills in the other so `STTTranscriptEvent` always carries both.
 *
 * Cartesia and OpenAI send deltas, AssemblyAI resends the whole turn,
 * Deepgram sends per-segment text — one tracker handles all three.
 */
export class TurnTextTracker {
    #turn = 0;
    #committed = "";
    #current = "";

    /** For providers that send a delta. */
    fromDelta(delta: string): { text: string; delta: string; turn: number } {
        this.#current = this.#committed + delta;
        return { text: this.#current, delta, turn: this.#turn };
    }

    /** For providers that resend the whole turn each time. */
    fromCumulative(text: string): { text: string; delta: string; turn: number } {
        const delta = text.startsWith(this.#current)
            ? text.slice(this.#current.length)
            : text;
        this.#current = text;
        return { text, delta, turn: this.#turn };
    }

    /** Call when a segment is stable but the turn continues (`is_final`). */
    commitSegment(): void {
        this.#committed = this.#current;
    }

    /** Call on `turn_end`. */
    endTurn(): void {
        this.#turn += 1;
        this.#committed = "";
        this.#current = "";
    }
}

// ---------------------------------------------------------------------------
// Migration note
// ---------------------------------------------------------------------------
//
// Renames from the current src/types.ts:
//   SynthesizeInput            -> SpeakInput      (+ voice/controls/format)
//   SynthesizeOutput           -> SpeakResult     (audio is bytes + format,
//                                                  not a single AudioChunk)
//   Transcription              -> TranscriptResult
//   Transcript                 -> STTTranscriptEvent (isFinal -> finality)
//   StreamingSynthesisInput    -> RealtimeTTSInput (text arrives via push(),
//                                                   not an AsyncIterable field)
//   StreamingTranscriptionInput-> RealtimeSTTInput
//   AudioChunk                 -> stays, but loses per-chunk format: format is
//                                 stream-scoped (AudioStream/TTSSession.format)
//
// The elevenlabs package already imports TTSEngine/STTEngine/TTSSession/
// TranscriptEvent/OutputFormat/Conditioning, none of which exist in core. It
// needs to move to this surface too: engines collapse into provider methods,
// OutputFormat -> AudioFormat, Conditioning -> VoiceControls,
// TranscriptEvent -> STTEvent.
