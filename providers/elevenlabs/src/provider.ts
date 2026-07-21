import type { VoiceProvider } from "@voice-sdk/core";
import type { ElevenLabsConfig } from "./config";
import { resolveConfig } from "./config";
import { ElevenLabsTTS } from "./tts";

/**
 * ElevenLabs provider. Supports text-to-speech (one-shot, output streaming, and
 * WebSocket input streaming). Declared with a **required** `tts` field so the
 * TTS capability is known at the type level.
 */
export class ElevenLabsProvider implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly tts: ElevenLabsTTS;

  constructor(config: ElevenLabsConfig = {}) {
    this.tts = new ElevenLabsTTS(resolveConfig(config));
  }
}
