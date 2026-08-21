import type WebSocket from "ws";
import type { RealtimeSTTInput, STTEvent, STTSession } from "@swungstudent/voice";
import {
    DEFAULT_REALTIME_INPUT_FORMAT,
    TurnTextTracker,
    ValidationError,
    VoiceError,
    withProviderOptions,
} from "@swungstudent/voice";
import { AsyncQueue } from "@voice-sdk/internal";
import type { ResolvedConfig } from "./config";
import { DEFAULTS, PROVIDER } from "./config";
import { fromWords, toRealtimeSTTFormat } from "./format";
import { buildUrl } from "./internal/http";
import { handshake, open, sendIfOpen, toText } from "./internal/socket";

/** Wire shapes for both endpoints, narrowed to the fields core models. */
interface STTMessage {
    type: string;
    request_id?: string;
    /** Manual: the segment just transcribed. */
    text?: string;
    is_final?: boolean;
    words?: unknown;
    language?: string;
    /** Auto: the whole turn, re-sent on every event. */
    transcript?: string;
    title?: string;
    message?: string;
}

/**
 * Push audio, receive transcripts. Cartesia splits realtime STT across two
 * endpoints:
 *
 * - `auto` (ink-2) -> `WSS /stt/turns/websocket`, detects turns and emits turn
 *   events
 * - `manual` (ink-whisper) -> `WSS /stt/websocket`, no turn detection at all —
 *   transcription only happens when the caller sends `finalize`
 *
 * `turnDetection` picks between them, and both are normalized to the same event
 * stream, so a consumer cannot tell which endpoint it is talking to.
 */
export class CartesiaSTTSession implements STTSession {
    #ws: WebSocket;
    #mode: "auto" | "manual";
    #tracker = new TurnTextTracker();
    #queue = new AsyncQueue<STTEvent>();
    #closed: Promise<void>;

    static async open(config: ResolvedConfig, input: RealtimeSTTInput = {}): Promise<CartesiaSTTSession> {
        const format = toRealtimeSTTFormat(input.inputFormat, DEFAULT_REALTIME_INPUT_FORMAT);
        const mode = input.turnDetection?.mode === "manual" ? "manual" : "auto";
        const model = input.model ?? config.defaultRealtimeSTTModel;

        if (mode === "manual") {
            const query = withProviderOptions(
                {
                    ...format,
                    model: model ?? DEFAULTS.manualSTTModel,
                    keyterm: input.keyterms,
                    language: input.language,
                },
                input.providerOptions,
            );

            return CartesiaSTTSession.#connect(
                buildUrl(config.baseUrl, "/stt/websocket", query),
                config.apiKey,
                mode,
            );
        }

        const autoModel = model ?? DEFAULTS.vadSTTModel;
        // Getting this wrong is not a small bug: ink-whisper would simply never
        // report a turn, and the caller would wait for one forever.
        if (autoModel.startsWith("ink-whisper")) {
            throw new ValidationError(
                PROVIDER,
                "model",
                `"${autoModel}" has no turn detection. Use turnDetection: { mode: "manual" }, or the ink-2 model.`,
            );
        }

        const turn = input.turnDetection?.mode === "vad" ? input.turnDetection : undefined;
        const query = withProviderOptions(
            {
                ...format,
                model: autoModel,
                keyterm: input.keyterms,
                turn_end_threshold: turn?.threshold,
                turn_end_timeout_ms:
                    turn?.silence === undefined ? undefined : Math.round(turn.silence * 1000),
            },
            input.providerOptions,
        );

        return CartesiaSTTSession.#connect(
            buildUrl(config.baseUrl, "/stt/turns/websocket", query),
            config.apiKey,
            mode,
        );
    }

    /**
     * Listeners are attached in this tick, before any I/O can be processed:
     * the auto endpoint sends `connected` the instant the socket opens, and
     * awaiting the handshake first would drop it on the floor.
     */
    static async #connect(url: URL, apiKey: string, mode: "auto" | "manual"): Promise<CartesiaSTTSession> {
        const ws = open(url, apiKey);
        const ready = handshake(ws, "STT");
        const session = new CartesiaSTTSession(ws, mode);

        await ready;
        return session;
    }

    private constructor(ws: WebSocket, mode: "auto" | "manual") {
        this.#ws = ws;
        this.#mode = mode;

        ws.on("message", (raw: WebSocket.RawData) => this.#receive(raw));
        ws.on("error", (error) => this.#queue.fail(new VoiceError(`Cartesia STT socket: ${String(error)}`)));

        this.#closed = new Promise((resolve) => {
            ws.on("close", () => {
                this.#queue.close();
                resolve();
            });
        });
    }

    get output(): AsyncIterable<STTEvent> {
        return this.#queue;
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(audio: Uint8Array): void {
        sendIfOpen(this.#ws, audio);
    }

    /** Manual mode transcribes on `finalize`; auto mode decides for itself. */
    async flush(): Promise<void> {
        if (this.#mode === "manual") sendIfOpen(this.#ws, "finalize");
    }

    /** Cartesia has no server-side discard, so this only drops the local turn. */
    cancel(): void {
        this.#tracker.endTurn();
    }

    async close(): Promise<void> {
        // The two endpoints say goodbye differently: manual takes a bare text
        // frame, auto takes a JSON message.
        if (this.#mode === "manual") sendIfOpen(this.#ws, "close");
        else sendIfOpen(this.#ws, JSON.stringify({ type: "close" }));
        await this.#closed;
    }

    #receive(raw: WebSocket.RawData): void {
        let message: STTMessage;
        try {
            message = JSON.parse(toText(raw)) as STTMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`Cartesia STT socket sent invalid JSON: ${String(error)}`));
            return;
        }

        if (this.#mode === "manual") this.#receiveManual(message);
        else this.#receiveAuto(message);
    }

    /**
     * ink-whisper sends text scoped to a **segment**, not the whole turn, so
     * each final has to be committed before the next segment is appended to it.
     */
    #receiveManual(message: STTMessage): void {
        switch (message.type) {
            case "transcript": {
                const { text, delta, turn } = this.#tracker.fromSegment(message.text ?? "");
                if (message.is_final) this.#tracker.commitSegment();

                this.#queue.push({
                    type: "transcript",
                    finality: message.is_final ? "final" : "partial",
                    text,
                    delta,
                    turn,
                    words: fromWords(message.words),
                    language: message.language,
                    raw: message,
                });
                return;
            }

            case "flush_done":
                // The caller declared the turn over and the server has now
                // drained it, which is the closest thing manual mode has to a
                // turn boundary.
                this.#queue.push({
                    type: "transcript",
                    finality: "turn_end",
                    text: this.#tracker.text,
                    delta: "",
                    turn: this.#tracker.turn,
                    raw: message,
                });
                this.#tracker.endTurn();
                return;

            case "done":
                this.#queue.close();
                return;

            default:
                this.#maybeFail(message);
        }
    }

    /** ink-2 re-sends the whole turn on every event, and names its lifecycle. */
    #receiveAuto(message: STTMessage): void {
        switch (message.type) {
            case "connected":
                this.#queue.push({ type: "metadata", requestId: message.request_id });
                return;

            case "turn.start":
                this.#queue.push({ type: "speech_started" });
                return;

            case "turn.update":
                this.#turn(message.transcript ?? "", "partial", message);
                return;

            // A predicted boundary turn.resume can still revoke, so it is a
            // stable segment rather than the end of the turn.
            case "turn.eager_end":
                this.#turn(message.transcript ?? "", "final", message);
                return;

            case "turn.resume":
                this.#turn(this.#tracker.text, "partial", message);
                return;

            case "turn.end":
                this.#turn(message.transcript ?? "", "turn_end", message);
                this.#tracker.endTurn();
                return;

            default:
                this.#maybeFail(message);
        }
    }

    #turn(transcript: string, finality: "partial" | "final" | "turn_end", raw: STTMessage): void {
        const { text, delta, turn } = this.#tracker.fromCumulative(transcript);
        this.#queue.push({ type: "transcript", finality, text, delta, turn, raw });
    }

    #maybeFail(message: STTMessage): void {
        if (message.type !== "error") return;

        this.#queue.fail(new VoiceError(`Cartesia STT session: ${message.title}: ${message.message}`));
    }
}
