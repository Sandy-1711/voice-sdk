import type WebSocket from "ws";
import type { RealtimeTTSInput, ResolvedAudioFormat, TTSEvent, TTSSession } from "@swungstudent/voice";
import { VoiceError, withProviderOptions } from "@swungstudent/voice";
import { DEFAULT_STREAM_FORMAT, type ResolvedConfig } from "./config";
import { assertNoTimings, toRealtimeOutputFormat, toSpeed } from "./format";
import { AsyncQueue } from "./internal/async-queue";
import { buildUrl } from "./internal/http";
import { handshake, open, sendWhenOpen, toBytes, toText } from "./internal/socket";

/** Wire shape. Audio arrives as binary frames; everything else is JSON. */
interface ServerMessage {
    type: string;
    sequence_id?: number;
    request_id?: string;
    model_name?: string;
    description?: string;
    code?: string;
}

/**
 * Push text, receive audio, over `WSS /v1/speak`.
 *
 * Deepgram is one of the few providers with a real barge-in: `Clear` drops
 * audio the server has already generated but not yet sent, so `cancel()` does
 * not have to fake it by dropping the connection.
 */
export class DeepgramTTSSession implements TTSSession {
    readonly format: ResolvedAudioFormat;

    #ws: WebSocket;
    #queue = new AsyncQueue<TTSEvent>();
    #closed: Promise<void>;

    static async open(config: ResolvedConfig, input: RealtimeTTSInput = {}): Promise<DeepgramTTSSession> {
        assertNoTimings(input.timings);

        const { params, resolved } = toRealtimeOutputFormat(
            input.format ?? config.defaultFormat,
            DEFAULT_STREAM_FORMAT,
        );
        const query = withProviderOptions(
            {
                ...params,
                // A Deepgram voice is a model name.
                model: input.model ?? input.voice ?? config.defaultModel,
                speed: toSpeed(input.controls),
            },
            input.providerOptions,
        );

        const ws = open(buildUrl(config.baseUrl, "/v1/speak", query), config.apiKey);
        // Both listener sets are attached in this tick, before any I/O can be
        // processed: Deepgram sends Metadata the instant the socket opens, and
        // awaiting the handshake first would drop it on the floor.
        const ready = handshake(ws, "TTS");
        const session = new DeepgramTTSSession(ws, resolved, input.signal);

        await ready;
        return session;
    }

    private constructor(ws: WebSocket, format: ResolvedAudioFormat, signal?: AbortSignal) {
        this.#ws = ws;
        this.format = format;

        ws.on("message", (raw, isBinary) => this.#receive(raw, isBinary));
        ws.on("error", (error) => this.#queue.fail(new VoiceError(`Deepgram TTS socket: ${String(error)}`)));

        this.#closed = new Promise((resolve) => {
            ws.on("close", () => {
                this.#queue.close();
                resolve();
            });
        });

        signal?.addEventListener("abort", () => void this.close(), { once: true });
    }

    get output(): AsyncIterable<TTSEvent> {
        return this.#queue;
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(text: string): void {
        sendWhenOpen(this.#ws, JSON.stringify({ type: "Speak", text }));
    }

    async flush(): Promise<void> {
        sendWhenOpen(this.#ws, JSON.stringify({ type: "Flush" }));
    }

    /** A true barge-in: the server drops whatever it has queued. */
    cancel(): void {
        sendWhenOpen(this.#ws, JSON.stringify({ type: "Clear" }));
    }

    async close(): Promise<void> {
        sendWhenOpen(this.#ws, JSON.stringify({ type: "Close" }));
        await this.#closed;
    }

    #receive(raw: WebSocket.RawData, isBinary: boolean): void {
        if (isBinary) {
            this.#queue.push({ type: "audio", data: toBytes(raw) });
            return;
        }

        let message: ServerMessage;
        try {
            message = JSON.parse(toText(raw)) as ServerMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`Deepgram TTS socket sent invalid JSON: ${String(error)}`));
            return;
        }

        switch (message.type) {
            case "Metadata":
                this.#queue.push({
                    type: "metadata",
                    requestId: message.request_id,
                    model: message.model_name,
                    raw: message,
                });
                return;

            case "Flushed":
                // Deepgram has no separate "generation complete" event, and
                // Flushed is exactly that — so `done` is synthesized here to
                // keep consumers that wait on it working across providers.
                this.#queue.push({ type: "flushed", id: message.sequence_id });
                this.#queue.push({ type: "done" });
                return;

            case "Cleared":
                this.#queue.push({ type: "cleared", id: message.sequence_id });
                return;

            case "Warning":
                this.#queue.push({
                    type: "warning",
                    message: message.description ?? "",
                    code: message.code,
                });
                return;

            default:
                if (message.type === "Error" || message.type === "Fatal") {
                    this.#queue.fail(
                        new VoiceError(
                            `Deepgram TTS session: ${message.code ?? message.type}: ${message.description ?? ""}`,
                        ),
                    );
                }
        }
    }
}
