import type {
  TTSEngine,
  SpeakInput,
  AudioResult,
  AudioChunk,
  TTSSession,
  TTSSessionInput,
} from "@voice-sdk/core";
import { VoiceError } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { toElevenOutputFormat, toVoiceSettings, resolveFormat } from "./config";
import { authHeaders, ensureOk } from "./internal/http";
import { ElevenLabsTTSSession } from "./tts-session";

export class ElevenLabsTTS implements TTSEngine {
  #config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.#config = config;
  }

  /** One-shot synthesis: full text in, full audio out. */
  async speak(input: SpeakInput): Promise<AudioResult> {
    const res = await this.#request(input, false);
    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, format: resolveFormat(input.outputFormat, this.#config) };
  }

  /** Output streaming: full text in, audio chunks out as they're generated. */
  async *stream(input: SpeakInput): AsyncIterable<AudioChunk> {
    const res = await this.#request(input, true);
    if (!res.body) throw new VoiceError("ElevenLabs: empty streaming response body.");
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }

  /** Input streaming: open a WebSocket session and push text tokens. */
  connect(input?: TTSSessionInput): TTSSession {
    return new ElevenLabsTTSSession(this.#config, input);
  }

  async #request(input: SpeakInput, stream: boolean): Promise<Response> {
    const voice = input.voice ?? this.#config.defaultVoice;
    const model = input.model ?? this.#config.defaultModel;
    const fmt = toElevenOutputFormat(
      input.outputFormat ?? this.#config.defaultOutputFormat,
    );

    const url = new URL(
      `/v1/text-to-speech/${voice}${stream ? "/stream" : ""}`,
      this.#config.baseUrl,
    );
    if (fmt) url.searchParams.set("output_format", fmt);

    return ensureOk(
      await fetch(url, {
        method: "POST",
        headers: {
          ...authHeaders(this.#config),
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: input.text,
          model_id: model,
          language_code: input.language,
          voice_settings: toVoiceSettings(input.conditioning),
          ...(input.providerOptions ?? {}),
        }),
      }),
      "TTS",
    );
  }
}
