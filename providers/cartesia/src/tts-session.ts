import type WebSocket from "ws";
import type { RealtimeTTSInput, ResolvedAudioFormat, TTSEvent, TTSSession } from "@swungstudent/voice";
import { decodeBase64, VoiceError, withProviderOptions } from "@swungstudent/voice";
import { AsyncQueue } from "@voice-sdk/internal";
import type { ResolvedConfig } from "./config";
import { DEFAULT_STREAM_FORMAT } from "./config";
import { fromTimestamps, toGenerationConfig, toRawOutputFormat, toVoice } from "./format";
import type { GenerationConfig } from "./format";
import { buildUrl } from "./internal/http";
import { handshake, open, sendWhenOpen, toText } from "./internal/socket";

/** Wire shape of what `/tts/websocket` sends back. */
interface ServerMessage {
    type: string;
    context_id?: string;
    data?: string;
    flush_id?: number;
    word_timestamps?: { words: string[]; start: number[]; end: number[] };
    phoneme_timestamps?: { phonemes: string[]; start: number[]; end: number[] };
    title?: string;
    message?: string;
}

/**
 * Push text, receive audio, over `/tts/websocket`.
 *
 * Cartesia has no handshake frame: every generation request repeats the whole
 * context configuration, keyed by `context_id`. One session owns exactly one
 * context, so callers never see it — and anything arriving on this socket is
 * ours, since nothing else shares it.
 */
export class CartesiaTTSSession implements TTSSession {
    readonly format: ResolvedAudioFormat;

    #ws: WebSocket;
    #contextId: string;
    #options: Record<string, unknown>;
    #generationConfig: GenerationConfig | undefined;
    #queue = new AsyncQueue<TTSEvent>();
    #closed: Promise<void>;

    static async open(config: ResolvedConfig, input: RealtimeTTSInput = {}): Promise<CartesiaTTSSession> {
        const { payload, resolved } = toRawOutputFormat(
            input.format ?? config.defaultFormat,
            DEFAULT_STREAM_FORMAT,
        );

        const options = withProviderOptions(
            {
                model_id: input.model ?? config.defaultModel,
                voice: toVoice(input.voice ?? config.defaultVoice),
                output_format: payload,
                language: input.language,
                add_timestamps: input.timings === true || input.timings === "word",
                add_phoneme_timestamps: input.timings === "phoneme",
            },
            input.providerOptions,
        );

        // Everything above can throw, and does so before a socket is opened.
        const ws = open(buildUrl(config.baseUrl, "/tts/websocket"), config.apiKey);
        const ready = handshake(ws, "TTS");
        const session = new CartesiaTTSSession(ws, options, resolved, toGenerationConfig(input.controls));

        await ready;
        return session;
    }

    private constructor(
        ws: WebSocket,
        options: Record<string, unknown>,
        format: ResolvedAudioFormat,
        generationConfig: GenerationConfig | undefined,
    ) {
        this.#ws = ws;
        this.#contextId = crypto.randomUUID();
        this.#options = options;
        this.format = format;
        this.#generationConfig = generationConfig;

        ws.on("message", (raw: WebSocket.RawData) => this.#receive(raw));
        ws.on("error", (error) => this.#queue.fail(new VoiceError(`Cartesia TTS socket: ${String(error)}`)));

        this.#closed = new Promise((resolve) => {
            ws.on("close", () => {
                this.#queue.close();
                resolve();
            });
        });
    }

    get output(): AsyncIterable<TTSEvent> {
        return this.#queue;
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(text: string): void {
        this.#send({
            transcript: text,
            continue: true,
            ...(this.#generationConfig ? { generation_config: this.#generationConfig } : {}),
        });
    }

    /** An empty transcript with `flush` set drains what is buffered. */
    async flush(): Promise<void> {
        this.#send({ transcript: "", continue: true, flush: true });
    }

    /** Cancelling drops queued audio but leaves the context usable. */
    cancel(): void {
        sendWhenOpen(this.#ws, JSON.stringify({ cancel: true, context_id: this.#contextId }));
    }

    async close(): Promise<void> {
        this.#send({ transcript: "", continue: false });
        this.#ws.close();
        await this.#closed;
    }

    /** Every request repeats the context configuration; only the verb differs. */
    #send(request: Record<string, unknown>): void {
        sendWhenOpen(this.#ws, JSON.stringify({ ...this.#options, ...request, context_id: this.#contextId }));
    }

    #receive(raw: WebSocket.RawData): void {
        let message: ServerMessage;
        try {
            message = JSON.parse(toText(raw)) as ServerMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`Cartesia TTS socket sent invalid JSON: ${String(error)}`));
            return;
        }

        // Nothing else shares this socket, so an unlabelled message is ours.
        if (message.context_id && message.context_id !== this.#contextId) return;

        switch (message.type) {
            case "chunk":
                if (message.data) this.#queue.push({ type: "audio", data: decodeBase64(message.data) });
                return;

            case "timestamps": {
                const timings = message.word_timestamps;
                if (timings) {
                    this.#queue.push({
                        type: "timing",
                        alignment: fromTimestamps(timings.words, timings.start, timings.end, "word"),
                    });
                }
                return;
            }

            case "phoneme_timestamps": {
                const timings = message.phoneme_timestamps;
                if (timings) {
                    this.#queue.push({
                        type: "timing",
                        alignment: fromTimestamps(timings.phonemes, timings.start, timings.end, "phoneme"),
                    });
                }
                return;
            }

            case "flush_done":
                this.#queue.push({ type: "flushed", id: message.flush_id });
                return;

            case "done":
                this.#queue.push({ type: "done" });
                this.#queue.close();
                return;

            case "error":
                this.#queue.fail(
                    new VoiceError(`Cartesia TTS session: ${message.title}: ${message.message}`),
                );
        }
    }
}
