import type { VoiceProvider } from "@voice-sdk/core";
import type { ElevenLabsConfig } from "./config";
import { resolveConfig } from "./config";
import { ElevenLabsTTS } from "./tts";
import { ElevenLabsSTT } from "./stt";
import { ElevenLabsCloning } from "./cloning";

/**
 * ElevenLabs provider. Supports the full contract:
 *  - **TTS**: one-shot, output streaming, and WebSocket input streaming
 *  - **STT**: batch transcription (Scribe)
 *  - **cloning**: create / list / delete voices
 *
 * Engines are declared as **required** fields so their capabilities are known
 * at the type level.
 */
export class ElevenLabsProvider implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly tts: ElevenLabsTTS;
  readonly stt: ElevenLabsSTT;
  readonly cloning: ElevenLabsCloning;

  constructor(config: ElevenLabsConfig = {}) {
    const resolved = resolveConfig(config);
    this.tts = new ElevenLabsTTS(resolved);
    this.stt = new ElevenLabsSTT(resolved);
    this.cloning = new ElevenLabsCloning(resolved);
  }
}
