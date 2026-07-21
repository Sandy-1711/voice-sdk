import type {
  STTEngine,
  TranscribeInput,
  Transcript,
  TranscriptEvent,
  TranscriptWord,
  AudioSource,
  AudioChunk,
  STTSession,
  STTSessionInput,
} from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { authHeaders, ensureOk } from "./internal/http";
import { collectAudio, concatChunks } from "./internal/collect";
import { AsyncQueue } from "./internal/async-queue";

const DEFAULT_STT_MODEL = "scribe_v1";

interface ElevenWord {
  text: string;
  start?: number;
  end?: number;
  type?: string; // "word" | "spacing" | "audio_event"
}
interface ElevenTranscript {
  text: string;
  language_code?: string;
  words?: ElevenWord[];
}

export class ElevenLabsSTT implements STTEngine {
  #config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.#config = config;
  }

  /** One-shot transcription: full audio in, full transcript out. */
  async transcribe(input: TranscribeInput): Promise<Transcript> {
    const bytes = await collectAudio(input.audio);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), "audio");
    form.append("model_id", input.model ?? DEFAULT_STT_MODEL);
    if (input.language) form.append("language_code", input.language);

    const url = new URL("/v1/speech-to-text", this.#config.baseUrl);
    const res = await ensureOk(
      await fetch(url, {
        method: "POST",
        headers: authHeaders(this.#config),
        body: form,
      }),
      "STT",
    );
    return this.#toTranscript((await res.json()) as ElevenTranscript);
  }

  /**
   * ElevenLabs Scribe is a batch API — there is no low-latency partial stream.
   * We collect the whole source, transcribe once, and emit a single final
   * event, so the streaming surface stays consistent across providers.
   */
  async *stream(input: AudioSource): AsyncIterable<TranscriptEvent> {
    const transcript = await this.transcribe({ audio: input });
    yield { text: transcript.text, isFinal: true, words: transcript.words };
  }

  /**
   * Batch-backed session: buffers pushed audio frames and transcribes them when
   * `end()` is called, emitting one final event. (No interim results, since the
   * underlying API is batch.)
   */
  connect(input?: STTSessionInput): STTSession {
    return new ElevenLabsSTTSession(this, input);
  }

  #toTranscript(data: ElevenTranscript): Transcript {
    const words: TranscriptWord[] | undefined = data.words
      ?.filter((w) => w.type == null || w.type === "word")
      .map((w) => ({ text: w.text, start: w.start ?? 0, end: w.end ?? 0 }));
    return { text: data.text, language: data.language_code, words };
  }
}

class ElevenLabsSTTSession implements STTSession {
  #engine: ElevenLabsSTT;
  #input: STTSessionInput;
  #chunks: Uint8Array[] = [];
  #queue = new AsyncQueue<TranscriptEvent>();

  constructor(engine: ElevenLabsSTT, input: STTSessionInput = {}) {
    this.#engine = engine;
    this.#input = input;
  }

  get output(): AsyncIterable<TranscriptEvent> {
    return this.#queue;
  }

  push(chunk: AudioChunk): void {
    this.#chunks.push(chunk);
  }

  /** No-op: batch STT can't emit partials before `end()`. */
  flush(): void {}

  cancel(): void {
    this.#chunks = [];
    this.#queue = new AsyncQueue<TranscriptEvent>();
  }

  end(): void {
    const audio = concatChunks(this.#chunks);
    this.#chunks = [];
    this.#engine
      .transcribe({
        audio,
        model: this.#input.model,
        language: this.#input.language,
        format: this.#input.format,
      })
      .then((t) => {
        this.#queue.push({ text: t.text, isFinal: true, words: t.words });
        this.#queue.close();
      })
      .catch((err) => this.#queue.fail(err));
  }
}
