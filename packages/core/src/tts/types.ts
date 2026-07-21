import type { OutputFormat } from "../audio";

/**
 * Provider-agnostic conditioning knobs. Each provider maps these onto its own
 * parameters and ignores what it doesn't support. Use `providerOptions` on
 * `SpeakInput` for anything not expressible here.
 */
export interface Conditioning {
  /** Playback speed. 1 = normal, <1 slower, >1 faster (typically 0.5–2.0). */
  speed?: number;
  /** How consistent/steady the voice is. 0–1. */
  stability?: number;
  /** Expressiveness / style exaggeration. 0–1. */
  style?: number;
  /** Pitch shift, provider-normalized (semitones or 0–1 depending on provider). */
  pitch?: number;
}

/** Input for one-shot (`speak`) and output-streaming (`stream`) synthesis. */
export interface SpeakInput {
  /** The text to synthesize. */
  text: string;
  /** Provider voice id or name. Falls back to the provider's default voice. */
  voice?: string;
  /** Provider model id. Falls back to the provider's default model. */
  model?: string;
  /** BCP-47 language tag, e.g. "en", "en-US". */
  language?: string;
  /** Desired audio output encoding. Falls back to the provider's default. */
  outputFormat?: OutputFormat;
  /** Prosody / style controls. */
  conditioning?: Conditioning;
  /** Escape hatch for provider-specific params not covered above. */
  providerOptions?: Record<string, unknown>;
}

/**
 * Config for a streaming-input (WebSocket) session. Same as `SpeakInput` but
 * without `text` — text arrives incrementally via `session.push(token)`.
 */
export type TTSSessionInput = Omit<SpeakInput, "text">;

/** Result of a one-shot synthesis. */
export interface AudioResult {
  /** The full synthesized audio. */
  audio: Uint8Array;
  /** The encoding of `audio` (resolved, never undefined). */
  format: OutputFormat;
  /** Audio duration in milliseconds, if the provider reports it. */
  durationMs?: number;
}
