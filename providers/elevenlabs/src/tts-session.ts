import WebSocket from "ws";
import { decodeBase64, ValidationError, VoiceError } from "@swungstudent/voice";
import type { RealtimeTTSInput, ResolvedAudioFormat, TTSEvent, TTSSession } from "@swungstudent/voice";
import { DEFAULT_BASE_URL, PROVIDER, type ResolvedConfig } from "./config";
import {
    assertCharacterTimings,
    DEFAULT_FORMAT,
    fromWsAlignment,
    toStreamOutputFormat,
    toVoiceSettings,
    type WsAlignment,
} from "./format";
import { AsyncQueue } from "./internal/async-queue";
import { toText } from "./internal/socket";

/** Wire shape. The SDK ships camelCase types; the socket speaks this. */
interface ServerMessage {
    audio?: string;
    isFinal?: boolean;
    alignment?: WsAlignment;
    normalizedAlignment?: WsAlignment;
}

/**
 * Push text, receive audio, over `/stream-input`.
 *
 * The socket opens lazily on the first push, which is what makes `cancel()`
 * work: ElevenLabs has no cancel command, so the only way to stop queued audio
 * is to drop the connection — and the next push transparently opens a new one.
 */
export class ElevenLabsTTSSession implements TTSSession {
    readonly format: ResolvedAudioFormat;

    #url: string;
    #apiKey: string;
    #handshake: Record<string, unknown>;
    #ws: WebSocket | null = null;
    #opening: Promise<WebSocket> | null = null;
    #queue = new AsyncQueue<TTSEvent>();
    #closed: Promise<void>;
    #onClosed!: () => void;

    static open(config: ResolvedConfig, input: RealtimeTTSInput = {}): ElevenLabsTTSSession {
        const voice = input.voice ?? config.defaultVoice;
        if (!voice) {
            throw new ValidationError(
                PROVIDER,
                "voice",
                "A voice id is required. Pass `voice` or set `defaultVoice` on the provider.",
            );
        }
        if (input.timings) assertCharacterTimings(input.timings);

        const { value, resolved } = toStreamOutputFormat(
            input.format ?? config.defaultFormat,
            DEFAULT_FORMAT,
        );

        const url = new URL(
            `/v1/text-to-speech/${encodeURIComponent(voice)}/stream-input`,
            config.baseUrl ?? DEFAULT_BASE_URL,
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("model_id", input.model ?? config.defaultModel);
        url.searchParams.set("output_format", value);
        if (input.language) url.searchParams.set("language_code", input.language);
        if (input.timings) url.searchParams.set("sync_alignment", "true");

        return new ElevenLabsTTSSession(url.toString(), config.apiKey, resolved, {
            // A single space is ElevenLabs' begin-of-stream marker.
            text: " ",
            voice_settings: toVoiceSettings(input.controls),
            ...(input.providerOptions ?? {}),
        });
    }

    private constructor(
        url: string,
        apiKey: string,
        format: ResolvedAudioFormat,
        handshake: Record<string, unknown>,
    ) {
        this.#url = url;
        this.#apiKey = apiKey;
        this.format = format;
        this.#handshake = handshake;
        this.#closed = new Promise((resolve) => {
            this.#onClosed = resolve;
        });
    }

    get output(): AsyncIterable<TTSEvent> {
        return this.#queue;
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(text: string): void {
        // ElevenLabs triggers generation on whitespace, so the trailing space
        // is load-bearing: without it the last word is held indefinitely.
        const chunk = text.endsWith(" ") ? text : `${text} `;
        this.#send({ text: chunk });
    }

    async flush(): Promise<void> {
        if (this.#ws) this.#send({ text: "", flush: true });
    }

    /** No cancel command exists, so drop the socket and start clean. */
    cancel(): void {
        this.#teardown();
        this.#queue = new AsyncQueue<TTSEvent>();
    }

    async close(): Promise<void> {
        if (this.#ws || this.#opening) {
            this.#send({ text: "" });
            await this.#closed;
        }
        this.#teardown();
        this.#onClosed();
    }

    #send(message: Record<string, unknown>): void {
        this.#connect()
            .then((ws) => ws.send(JSON.stringify(message)))
            .catch((error) => this.#queue.fail(error));
    }

    #connect(): Promise<WebSocket> {
        if (this.#ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.#ws);
        if (!this.#opening) this.#opening = this.#open();
        return this.#opening;
    }

    #open(): Promise<WebSocket> {
        const ws = new WebSocket(this.#url, { headers: { "xi-api-key": this.#apiKey } });
        this.#ws = ws;

        ws.on("message", (raw: WebSocket.RawData) => this.#receive(raw));
        ws.on("error", (error) =>
            this.#queue.fail(new VoiceError(`ElevenLabs TTS socket: ${String(error)}`)),
        );
        ws.on("close", () => {
            this.#queue.close();
            this.#onClosed();
        });

        return new Promise((resolve, reject) => {
            ws.on("open", () => {
                ws.send(JSON.stringify(this.#handshake));
                resolve(ws);
            });
            ws.once("error", (error) =>
                reject(new VoiceError(`ElevenLabs TTS socket failed to open: ${String(error)}`)),
            );
        });
    }

    #receive(raw: WebSocket.RawData): void {
        let message: ServerMessage;
        try {
            message = JSON.parse(toText(raw)) as ServerMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`ElevenLabs TTS socket sent invalid JSON: ${String(error)}`));
            return;
        }

        if (message.audio) this.#queue.push({ type: "audio", data: decodeBase64(message.audio) });

        const alignment = fromWsAlignment(message.alignment ?? message.normalizedAlignment);
        if (alignment) this.#queue.push({ type: "timing", alignment });

        if (message.isFinal) {
            this.#queue.push({ type: "done" });
            this.#queue.close();
        }
    }

    #teardown(): void {
        const ws = this.#ws;
        this.#ws = null;
        this.#opening = null;
        if (!ws) return;

        ws.removeAllListeners();
        try {
            ws.close();
        } catch {
            /* already gone */
        }
    }
}
