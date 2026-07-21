import type { OutputFormat, Conditioning } from "@voice-sdk/core";

/** BYOK + defaults for the ElevenLabs provider. */
export interface ElevenLabsConfig {
  /** API key. Falls back to the `ELEVENLABS_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Defaults to the public ElevenLabs API. */
  baseUrl?: string;
  /** Default voice id used when a call doesn't specify one. */
  defaultVoice?: string;
  /** Default model id used when a call doesn't specify one. */
  defaultModel?: string;
  /** Default output format used when a call doesn't specify one. */
  defaultOutputFormat?: OutputFormat;
}

export const DEFAULTS = {
  baseUrl: "https://api.elevenlabs.io",
  voice: "21m00Tcm4TlvDq8ikWAM", // "Rachel"
  model: "eleven_multilingual_v2",
} as const;

/** Config with all required fields resolved. */
export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  defaultVoice: string;
  defaultModel: string;
  defaultOutputFormat?: OutputFormat;
}

export function resolveConfig(config: ElevenLabsConfig): ResolvedConfig {
  const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ElevenLabs: missing API key. Pass `apiKey` or set ELEVENLABS_API_KEY.",
    );
  }
  return {
    apiKey,
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    defaultVoice: config.defaultVoice ?? DEFAULTS.voice,
    defaultModel: config.defaultModel ?? DEFAULTS.model,
    defaultOutputFormat: config.defaultOutputFormat,
  };
}

/**
 * Map the SDK's provider-agnostic `OutputFormat` to an ElevenLabs
 * `output_format` string (e.g. `mp3_44100_128`). Returns `undefined` to let the
 * server pick its default.
 */
export function toElevenOutputFormat(format?: OutputFormat): string | undefined {
  if (!format) return undefined;
  const sr = format.sampleRate;
  switch (format.container) {
    case "mp3":
      return `mp3_${sr ?? 44100}_${format.bitrate ?? 128}`;
    case "pcm":
      return `pcm_${sr ?? 16000}`;
    case "ulaw":
      return "ulaw_8000";
    default:
      return undefined;
  }
}

/** Resolve the format we'll report back on `AudioResult.format`. */
export function resolveFormat(
  input: OutputFormat | undefined,
  config: ResolvedConfig,
): OutputFormat {
  return (
    input ??
    config.defaultOutputFormat ?? { container: "mp3", sampleRate: 44100, bitrate: 128 }
  );
}

/** Map the SDK's `Conditioning` to an ElevenLabs `voice_settings` object. */
export function toVoiceSettings(
  c?: Conditioning,
): Record<string, unknown> | undefined {
  if (!c) return undefined;
  const vs: Record<string, unknown> = {};
  if (c.stability != null) vs.stability = c.stability;
  if (c.style != null) vs.style = c.style;
  if (c.speed != null) vs.speed = c.speed;
  return Object.keys(vs).length > 0 ? vs : undefined;
}
