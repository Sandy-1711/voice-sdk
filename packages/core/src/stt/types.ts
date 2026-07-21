import type { AudioSource, OutputFormat } from "../audio";

/** Input for one-shot (`transcribe`) transcription. */
export interface TranscribeInput {
  /** The audio to transcribe — in-memory bytes or a stream. */
  audio: AudioSource;
  /** Provider model id. Falls back to the provider's default model. */
  model?: string;
  /** BCP-47 language hint, e.g. "en", "en-US". Omit to auto-detect. */
  language?: string;
  /** Hint about the input audio encoding, when it can't be inferred. */
  format?: OutputFormat;
  /** Escape hatch for provider-specific params not covered above. */
  providerOptions?: Record<string, unknown>;
}

/** A single word with timing, when the provider supports word-level timestamps. */
export interface TranscriptWord {
  text: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Recognition confidence, 0–1, if reported. */
  confidence?: number;
}

/** The full transcript of a one-shot transcription. */
export interface Transcript {
  /** The complete recognized text. */
  text: string;
  /** Detected or provided language (BCP-47). */
  language?: string;
  /** Word-level timing, if the provider supports it. */
  words?: TranscriptWord[];
  /** Audio duration in milliseconds, if reported. */
  durationMs?: number;
}

/** An incremental transcript event during streaming recognition. */
export interface TranscriptEvent {
  /** The text for this segment. */
  text: string;
  /**
   * `true` = a finalized segment that won't change.
   * `false` = an interim/partial hypothesis that may be revised.
   */
  isFinal: boolean;
  /** Word-level timing for this segment, if the provider supports it. */
  words?: TranscriptWord[];
}

/**
 * Config for a streaming-input (WebSocket) session. Same as `TranscribeInput`
 * but without `audio` — audio frames arrive via `session.push(chunk)`.
 */
export type STTSessionInput = Omit<TranscribeInput, "audio">;
