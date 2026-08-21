import type { Cartesia } from "@cartesia/cartesia-js";
import type { RealtimeSTTInput, STTEvent, STTSession } from "@swungstudent/voice";
import {
    DEFAULT_REALTIME_INPUT_FORMAT,
    TurnTextTracker,
    ValidationError,
    VoiceError,
    withProviderOptions,
} from "@swungstudent/voice";
import type { ResolvedConfig } from "./config";
import { DEFAULTS, PROVIDER } from "./config";
import { fromWords, toSTTEncoding } from "./format";

type AutoWS = ReturnType<Cartesia["stt"]["autoFinalize"]["websocket"]>;
type ManualWS = ReturnType<Cartesia["stt"]["manualFinalize"]["websocket"]>;
type ManualModel = Parameters<Cartesia["stt"]["manualFinalize"]["websocket"]>[0]["model"];

/**
 * Cartesia splits realtime STT across two endpoints:
 *
 * - `auto` (ink-2) detects turns and emits turn events
 * - `manual` (ink-whisper) has no turn detection at all — transcription only
 *   happens when the caller sends `finalize`
 *
 * `turnDetection` picks between them, and both are normalized to the same
 * event stream.
 */
export class CartesiaSTTSession implements STTSession {
    #ws: AutoWS | ManualWS;
    #mode: "auto" | "manual";
    #tracker = new TurnTextTracker();
    #closed: Promise<void>;

    static open(client: Cartesia, config: ResolvedConfig, input: RealtimeSTTInput = {}): CartesiaSTTSession {
        const format = input.inputFormat ?? DEFAULT_REALTIME_INPUT_FORMAT;
        const encoding = toSTTEncoding(format) ?? "pcm_s16le";
        const sample_rate = format.sampleRate ?? DEFAULT_REALTIME_INPUT_FORMAT.sampleRate;
        const mode = input.turnDetection?.mode === "manual" ? "manual" : "auto";

        if (mode === "manual") {
            const params = withProviderOptions(
                {
                    model: (input.model ?? DEFAULTS.manualSTTModel) as ManualModel,
                    encoding,
                    sample_rate,
                    keyterm: input.keyterms,
                    language: input.language as "en" | undefined,
                },
                input.providerOptions,
            );

            return new CartesiaSTTSession(client.stt.manualFinalize.websocket(params), mode);
        }

        const model = input.model ?? DEFAULTS.vadSTTModel;
        if (model.startsWith("ink-whisper")) {
            throw new ValidationError(
                PROVIDER,
                "model",
                `"${model}" has no turn detection. Use turnDetection: { mode: "manual" }, or the ink-2 model.`,
            );
        }

        const turn = input.turnDetection?.mode === "vad" ? input.turnDetection : undefined;
        const params = withProviderOptions(
            {
                model,
                encoding,
                sample_rate,
                keyterm: input.keyterms,
                turn_end_threshold: turn?.threshold,
                turn_end_timeout_ms:
                    turn?.silence === undefined ? undefined : Math.round(turn.silence * 1000),
            },
            input.providerOptions,
        );

        return new CartesiaSTTSession(client.stt.autoFinalize.websocket(params), mode);
    }

    private constructor(ws: AutoWS | ManualWS, mode: "auto" | "manual") {
        this.#ws = ws;
        this.#mode = mode;
        this.#closed = new Promise((resolve) => {
            // Both sockets emit the same events; the union of their listener
            // maps is not callable, so narrow to either one.
            const socket = ws as ManualWS;
            socket.on("close", () => resolve());
            // With nothing listening for `error` the SDK calls Promise.reject
            // itself, which is an unhandled rejection and fatal on current
            // Node. The error still reaches the caller through stream(), which
            // yields it as an `error` event; binding here settles the session
            // and keeps the SDK from throwing at the process as well.
            socket.on("error", () => resolve());
        });
    }

    get output(): AsyncIterable<STTEvent> {
        return this.#mode === "manual"
            ? this.#manualEvents(this.#ws as ManualWS)
            : this.#autoEvents(this.#ws as AutoWS);
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(audio: Uint8Array): void {
        this.#ws.sendRaw(audio);
    }

    /** Manual mode transcribes on `finalize`; auto mode decides for itself. */
    async flush(): Promise<void> {
        if (this.#mode === "manual") (this.#ws as ManualWS).send("finalize");
    }

    /** Cartesia has no server-side discard, so this only drops the local turn. */
    cancel(): void {
        this.#tracker.endTurn();
    }

    async close(): Promise<void> {
        if (this.#mode === "manual") (this.#ws as ManualWS).send("close");
        else (this.#ws as AutoWS).send({ type: "close" });
        await this.#closed;
    }

    async *#manualEvents(ws: ManualWS): AsyncIterable<STTEvent> {
        for await (const event of ws.stream()) {
            if (event.type === "error") throw toSessionError(event.error);
            if (event.type !== "message") continue;
            const message = event.message;

            switch (message.type) {
                case "transcript": {
                    const { text, delta, turn } = this.#tracker.fromSegment(message.text);
                    if (message.is_final) this.#tracker.commitSegment();
                    yield {
                        type: "transcript",
                        finality: message.is_final ? "final" : "partial",
                        text,
                        delta,
                        turn,
                        words: fromWords(message.words),
                        language: message.language,
                        raw: message,
                    };
                    break;
                }
                case "flush_done": {
                    // The caller declared the turn over and the server has now
                    // drained it, which is the closest thing manual mode has to
                    // a turn boundary.
                    yield {
                        type: "transcript",
                        finality: "turn_end",
                        text: this.#tracker.text,
                        delta: "",
                        turn: this.#tracker.turn,
                        raw: message,
                    };
                    this.#tracker.endTurn();
                    break;
                }
                case "done":
                    return;
                case "error":
                    throw new VoiceError(`Cartesia STT session: ${message.title}: ${message.message}`);
            }
        }
    }

    async *#autoEvents(ws: AutoWS): AsyncIterable<STTEvent> {
        for await (const event of ws.stream()) {
            if (event.type === "error") throw toSessionError(event.error);
            if (event.type !== "message") continue;
            const message = event.message;

            switch (message.type) {
                case "connected":
                    yield { type: "metadata", requestId: message.request_id };
                    break;
                case "turn.start":
                    yield { type: "speech_started" };
                    break;
                case "turn.update":
                    yield this.#turn(message.transcript, "partial", message);
                    break;
                // A predicted boundary the model can still revoke with turn.resume,
                // so it is a stable segment rather than the end of the turn.
                case "turn.eager_end":
                    yield this.#turn(message.transcript, "final", message);
                    break;
                case "turn.resume":
                    yield this.#turn(this.#tracker.text, "partial", message);
                    break;
                case "turn.end": {
                    yield this.#turn(message.transcript, "turn_end", message);
                    this.#tracker.endTurn();
                    break;
                }
                case "error":
                    throw new VoiceError(`Cartesia STT session: ${message.title}: ${message.message}`);
            }
        }
    }

    #turn(transcript: string, finality: "partial" | "final" | "turn_end", raw: unknown): STTEvent {
        const { text, delta, turn } = this.#tracker.fromCumulative(transcript);
        return { type: "transcript", finality, text, delta, turn, raw };
    }
}

/**
 * The SDK never yields an API error as a message: both API failures and socket
 * failures are funnelled into the stream's own `error` event. Skipping those
 * would leave a failed session silently waiting for transcripts that are never
 * coming.
 *
 * An API failure arrives as the JSON payload stringified into the message, so
 * it is unwrapped back into "title: message" rather than shown as raw JSON.
 */
function toSessionError(error: unknown): VoiceError {
    const detail = error instanceof Error ? error.message : String(error);

    try {
        const parsed = JSON.parse(detail) as { title?: string; message?: string };
        const summary = [parsed.title, parsed.message].filter(Boolean).join(": ");
        if (summary) return new VoiceError(`Cartesia STT session: ${summary}`);
    } catch {
        /* not JSON; the raw message is the best we have */
    }

    return new VoiceError(`Cartesia STT session: ${detail}`);
}
