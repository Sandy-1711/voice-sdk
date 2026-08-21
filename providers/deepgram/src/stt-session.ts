import type WebSocket from "ws";
import type { Finality, RealtimeSTTInput, STTEvent, STTSession } from "@swungstudent/voice";
import {
    DEFAULT_REALTIME_INPUT_FORMAT,
    TurnTextTracker,
    ValidationError,
    VoiceError,
    withProviderOptions,
} from "@swungstudent/voice";
import { PROVIDER, type ResolvedConfig } from "./config";
import { fromWords, toRealtimeSTTFormat, type WireWord } from "./format";
import { AsyncQueue } from "@voice-sdk/internal";
import { buildUrl } from "./internal/http";
import { handshake, open, sendWhenOpen, toText } from "./internal/socket";

/** Wire shapes for both endpoints, narrowed to the fields core models. */
interface ListenMessage {
    type: string;
    is_final?: boolean;
    speech_final?: boolean;
    channel?: {
        alternatives?: {
            transcript?: string;
            confidence?: number;
            languages?: string[];
            words?: WireWord[];
        }[];
    };
    metadata?: { request_id?: string };
    request_id?: string;
    timestamp?: number;
    last_word_end?: number;
    description?: string;
    code?: string;
}

interface FluxMessage {
    type: string;
    event?: string;
    request_id?: string;
    transcript?: string;
    words?: WireWord[];
    audio_window_start?: number;
    audio_window_end?: number;
    end_of_turn_confidence?: number;
    languages?: string[];
    description?: string;
    code?: string;
}

/** Deepgram closes an idle socket, so nova-3 needs a heartbeat well inside 10s. */
const KEEPALIVE_MS = 8000;

/**
 * Push audio, receive transcripts. Deepgram splits realtime STT across two
 * endpoints and the **model** picks between them:
 *
 * - `nova-3` and friends -> `WSS /v1/listen`, two-level finality
 *   (`is_final` = segment stable, `speech_final` = endpoint hit), and a
 *   mandatory `KeepAlive` heartbeat.
 * - `flux-general-*` -> `WSS /v2/listen`, turn lifecycle events and no
 *   heartbeat.
 *
 * Both are normalized to the same event stream, so a consumer cannot tell which
 * endpoint it is talking to.
 */
export class DeepgramSTTSession implements STTSession {
    #ws: WebSocket;
    #mode: "listen" | "flux";
    #tracker = new TurnTextTracker();
    #queue = new AsyncQueue<STTEvent>();
    #withWords: boolean;
    #keepAlive: ReturnType<typeof setInterval> | undefined;
    #closed: Promise<void>;

    static async open(config: ResolvedConfig, input: RealtimeSTTInput = {}): Promise<DeepgramSTTSession> {
        const model = input.model ?? config.defaultRealtimeSTTModel;
        const mode = model.startsWith("flux") ? "flux" : "listen";

        const turn = input.turnDetection;
        const vad = turn?.mode === "vad" ? turn : undefined;
        const manual = turn?.mode === "manual";
        const silenceMs = vad?.silence === undefined ? undefined : Math.round(vad.silence * 1000);
        const format = toRealtimeSTTFormat(input.inputFormat, DEFAULT_REALTIME_INPUT_FORMAT);

        if (mode === "flux") {
            // Getting this wrong is not a small bug: Flux would simply never
            // honour a flush(), and the caller would wait for turns forever.
            if (manual) {
                throw new ValidationError(
                    PROVIDER,
                    "turnDetection",
                    `"${model}" decides turns itself and has no manual finalize. Use turnDetection: { mode: "vad" }, or the nova-3 model.`,
                );
            }

            const query = withProviderOptions(
                {
                    ...format,
                    model,
                    language_hint: input.language,
                    keyterm: input.keyterms,
                    eot_threshold: vad?.threshold,
                    eot_timeout_ms: silenceMs,
                },
                input.providerOptions,
            );

            return DeepgramSTTSession.#connect(
                buildUrl(config.baseUrl, "/v2/listen", query),
                config.apiKey,
                mode,
                input,
            );
        }

        const query = withProviderOptions(
            {
                ...format,
                model,
                language: input.language,
                interim_results: input.interimResults,
                diarize: input.diarize,
                keyterm: input.keyterms,
                // Manual mode puts turn boundaries under the caller's flush(), so
                // Deepgram's own endpointer is switched off entirely.
                endpointing: manual ? false : silenceMs,
                // UtteranceEnd is what becomes `speech_ended`, but Deepgram rejects
                // a window under a second — so it is only requested when valid.
                utterance_end_ms:
                    manual || silenceMs === undefined || silenceMs < 1000 ? undefined : silenceMs,
                vad_events: manual ? undefined : true,
            },
            input.providerOptions,
        );

        return DeepgramSTTSession.#connect(
            buildUrl(config.baseUrl, "/v1/listen", query),
            config.apiKey,
            mode,
            input,
        );
    }

    /**
     * Both listener sets are attached in this tick, before any I/O can be
     * processed: Deepgram sends `Metadata` / `Connected` the instant the socket
     * opens, and awaiting the handshake first would drop it on the floor.
     */
    static async #connect(
        url: URL,
        apiKey: string,
        mode: "listen" | "flux",
        input: RealtimeSTTInput,
    ): Promise<DeepgramSTTSession> {
        const ws = open(url, apiKey);
        const ready = handshake(ws, "STT");
        const session = new DeepgramSTTSession(ws, mode, input);

        await ready;
        return session;
    }

    private constructor(ws: WebSocket, mode: "listen" | "flux", input: RealtimeSTTInput) {
        this.#ws = ws;
        this.#mode = mode;
        this.#withWords = input.timestamps !== false;

        ws.on("message", (raw) => this.#receive(raw));
        ws.on("error", (error) => this.#queue.fail(new VoiceError(`Deepgram STT socket: ${String(error)}`)));

        this.#closed = new Promise((resolve) => {
            ws.on("close", () => {
                this.#stopKeepAlive();
                this.#queue.close();
                resolve();
            });
        });

        if (mode === "listen") {
            this.#keepAlive = setInterval(() => {
                sendWhenOpen(ws, JSON.stringify({ type: "KeepAlive" }));
            }, KEEPALIVE_MS);
            // A heartbeat should not be the reason a process refuses to exit.
            this.#keepAlive.unref?.();
        }

        input.signal?.addEventListener("abort", () => void this.close(), { once: true });
    }

    get output(): AsyncIterable<STTEvent> {
        return this.#queue;
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(audio: Uint8Array): void {
        sendWhenOpen(this.#ws, audio);
    }

    /** Flux decides turns for itself, so only nova-3 has anything to finalize. */
    async flush(): Promise<void> {
        if (this.#mode === "listen") sendWhenOpen(this.#ws, JSON.stringify({ type: "Finalize" }));
    }

    /** Deepgram has no server-side discard, so this only drops the local turn. */
    cancel(): void {
        this.#tracker.endTurn();
    }

    async close(): Promise<void> {
        this.#stopKeepAlive();
        sendWhenOpen(this.#ws, JSON.stringify({ type: "CloseStream" }));
        await this.#closed;
    }

    #stopKeepAlive(): void {
        if (this.#keepAlive === undefined) return;
        clearInterval(this.#keepAlive);
        this.#keepAlive = undefined;
    }

    #receive(raw: WebSocket.RawData): void {
        let message: ListenMessage & FluxMessage;
        try {
            message = JSON.parse(toText(raw)) as ListenMessage & FluxMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`Deepgram STT socket sent invalid JSON: ${String(error)}`));
            return;
        }

        if (this.#mode === "flux") this.#receiveFlux(message);
        else this.#receiveListen(message);
    }

    /**
     * nova-3 sends text scoped to a **segment**, not the whole turn, so each
     * final has to be committed before the next segment is appended to it.
     */
    #receiveListen(message: ListenMessage): void {
        switch (message.type) {
            case "Results": {
                const best = message.channel?.alternatives?.[0];
                const { text, delta, turn } = this.#tracker.fromSegment(best?.transcript ?? "");

                // speech_final means the endpointer fired, which outranks the
                // is_final that rides along with it.
                const finality: Finality = message.speech_final
                    ? "turn_end"
                    : message.is_final
                      ? "final"
                      : "partial";

                this.#queue.push({
                    type: "transcript",
                    finality,
                    text,
                    delta,
                    turn,
                    words: this.#withWords ? fromWords(best?.words) : undefined,
                    language: best?.languages?.[0],
                    confidence: best?.confidence,
                    raw: message,
                });

                if (finality === "turn_end") this.#tracker.endTurn();
                else if (finality === "final") this.#tracker.commitSegment();
                return;
            }

            case "SpeechStarted":
                this.#queue.push({ type: "speech_started", at: message.timestamp });
                return;

            case "UtteranceEnd":
                this.#queue.push({ type: "speech_ended", at: message.last_word_end });
                return;

            case "Metadata":
                this.#queue.push({
                    type: "metadata",
                    requestId: message.metadata?.request_id ?? message.request_id,
                    raw: message,
                });
                return;

            default:
                this.#maybeFail(message.type, message.code, message.description);
        }
    }

    /** Flux re-sends the whole turn on every event, and names its own lifecycle. */
    #receiveFlux(message: FluxMessage): void {
        switch (message.type) {
            case "Connected":
                this.#queue.push({ type: "metadata", requestId: message.request_id, raw: message });
                return;

            case "TurnInfo": {
                if (message.event === "StartOfTurn") {
                    this.#queue.push({ type: "speech_started", at: message.audio_window_start });
                    return;
                }

                const finality = FLUX_FINALITY[message.event ?? ""];
                if (!finality) return;

                const { text, delta, turn } = this.#tracker.fromCumulative(message.transcript ?? "");
                this.#queue.push({
                    type: "transcript",
                    finality,
                    text,
                    delta,
                    turn,
                    start: message.audio_window_start,
                    end: message.audio_window_end,
                    words: this.#withWords ? fromWords(message.words) : undefined,
                    language: message.languages?.[0],
                    endOfTurnConfidence: message.end_of_turn_confidence,
                    raw: message,
                });

                if (finality === "turn_end") this.#tracker.endTurn();
                return;
            }

            default:
                this.#maybeFail(message.type, message.code, message.description);
        }
    }

    #maybeFail(type: string, code: string | undefined, description: string | undefined): void {
        if (!type.toLowerCase().includes("error") && !type.toLowerCase().includes("fatal")) return;

        this.#queue.fail(new VoiceError(`Deepgram STT session: ${code ?? type}: ${description ?? ""}`));
    }
}

/**
 * `EagerEndOfTurn` is a predicted boundary that `TurnResumed` can revoke, so it
 * is a stable segment rather than the end of the turn — which is exactly what
 * core's middle finality state is for.
 */
const FLUX_FINALITY: Record<string, Finality | undefined> = {
    Update: "partial",
    EagerEndOfTurn: "final",
    TurnResumed: "partial",
    EndOfTurn: "turn_end",
};
