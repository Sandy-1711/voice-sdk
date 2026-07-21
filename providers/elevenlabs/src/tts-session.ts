import WebSocket from "ws";
import type { TTSSession, TTSSessionInput, AudioChunk } from "@voice-sdk/core";
import { VoiceError } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { toElevenOutputFormat, toVoiceSettings } from "./config";
import { AsyncQueue } from "./internal/async-queue";

interface ElevenWSMessage {
  audio?: string; // base64
  isFinal?: boolean;
}

/**
 * ElevenLabs input-streaming session over the `/stream-input` WebSocket.
 * Push text tokens; audio chunks arrive on `output`.
 *
 * The socket is opened lazily on the first `push`/`end`, so a session created
 * by `connect()` costs nothing until you use it — and `cancel()` can tear the
 * socket down while leaving the session reusable for the next turn.
 */
export class ElevenLabsTTSSession implements TTSSession {
  #config: ResolvedConfig;
  #input: TTSSessionInput;
  #ws: WebSocket | null = null;
  #opening: Promise<WebSocket> | null = null;
  #queue = new AsyncQueue<AudioChunk>();

  constructor(config: ResolvedConfig, input: TTSSessionInput = {}) {
    this.#config = config;
    this.#input = input;
  }

  get output(): AsyncIterable<AudioChunk> {
    return this.#queue;
  }

  push(text: string): void {
    // ElevenLabs triggers generation on whitespace, so ensure a trailing space.
    const chunk = text.endsWith(" ") ? text : `${text} `;
    this.#ensureOpen()
      .then((ws) => ws.send(JSON.stringify({ text: chunk })))
      .catch((err) => this.#queue.fail(err));
  }

  flush(): void {
    const ws = this.#ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text: "", flush: true }));
    }
  }

  cancel(): void {
    // Barge-in: drop the current socket + pending audio, keep the session
    // usable — the next push() opens a fresh connection.
    this.#teardown();
    this.#queue = new AsyncQueue<AudioChunk>();
  }

  end(): void {
    // Empty text is ElevenLabs' end-of-stream signal.
    this.#ensureOpen()
      .then((ws) => ws.send(JSON.stringify({ text: "" })))
      .catch(() => {
        /* failure already surfaced on output */
      });
  }

  #ensureOpen(): Promise<WebSocket> {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.#ws);
    }
    if (!this.#opening) this.#opening = this.#open();
    return this.#opening;
  }

  #open(): Promise<WebSocket> {
    const voice = this.#input.voice ?? this.#config.defaultVoice;
    const model = this.#input.model ?? this.#config.defaultModel;
    const fmt = toElevenOutputFormat(
      this.#input.outputFormat ?? this.#config.defaultOutputFormat,
    );

    const url =
      this.#config.baseUrl.replace(/^http/, "ws") +
      `/v1/text-to-speech/${voice}/stream-input` +
      `?model_id=${encodeURIComponent(model)}` +
      (fmt ? `&output_format=${fmt}` : "");

    const ws = new WebSocket(url, { headers: { "xi-api-key": this.#config.apiKey } });
    this.#ws = ws;

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as ElevenWSMessage;
        if (msg.audio) {
          this.#queue.push(new Uint8Array(Buffer.from(msg.audio, "base64")));
        }
        if (msg.isFinal) this.#queue.close();
      } catch (err) {
        this.#queue.fail(err);
      }
    });
    ws.on("error", (err) =>
      this.#queue.fail(new VoiceError(`ElevenLabs WS error: ${String(err)}`)),
    );
    ws.on("close", () => this.#queue.close());

    return new Promise<WebSocket>((resolve, reject) => {
      ws.on("open", () => {
        // BOS: initialise the stream with voice settings before any text.
        ws.send(
          JSON.stringify({
            text: " ",
            voice_settings: toVoiceSettings(this.#input.conditioning),
          }),
        );
        resolve(ws);
      });
      ws.once("error", (err) =>
        reject(new VoiceError(`ElevenLabs WS connect failed: ${String(err)}`)),
      );
    });
  }

  #teardown(): void {
    this.#opening = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}
