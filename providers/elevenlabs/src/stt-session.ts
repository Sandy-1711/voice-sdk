import WebSocket from "ws";
import { encodeBase64, TurnTextTracker, VoiceError } from "@swungstudent/voice";
import type {
    Finality,
    RealtimeSTTInput,
    STTEvent,
    STTSession,
    TranscriptWord,
} from "@swungstudent/voice";
import { DEFAULT_BASE_URL, type ResolvedConfig } from "./config";
import { toRealtimeAudioFormat } from "./format";
import { AsyncQueue } from "./internal/async-queue";

/** Wire shape. The SDK ships camelCase types; the socket speaks this. */
interface ServerMessage {
    message_type: string;
    session_id?: string;
    text?: string;
    language_code?: string;
    words?: { text: string; start?: number; end?: number; type?: string; speaker_id?: string; logprob?: number }[];
    message?: string;
    error?: string;
}

/**
 * Push audio, receive transcripts, over `/speech-to-text/realtime`.
 *
 * ElevenLabs is the one provider whose finality model maps onto core's without
 * inventing anything: partial -> final -> committed lines up exactly with
 * partial / final / turn_end.
 */
export class ElevenLabsSTTSession implements STTSession {
    #ws: WebSocket;
    #queue = new AsyncQueue<STTEvent>();
    #tracker = new TurnTextTracker();
    #withTimestamps: boolean;
    #closed: Promise<void>;

    static open(config: ResolvedConfig, input: RealtimeSTTInput = {}): ElevenLabsSTTSession {
        const url = new URL("/v1/speech-to-text/realtime", config.baseUrl ?? DEFAULT_BASE_URL);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("model_id", input.model ?? config.defaultRealtimeSTTModel);
        url.searchParams.set("audio_format", toRealtimeAudioFormat(input.inputFormat));
        if (input.language) url.searchParams.set("language_code", input.language);
        if (input.timestamps) url.searchParams.set("include_timestamps", "true");
        for (const term of input.keyterms ?? []) url.searchParams.append("keyterms", term);

        // Manual mode leaves turn boundaries to the caller's flush().
        const turn = input.turnDetection;
        url.searchParams.set("commit_strategy", turn?.mode === "manual" ? "manual" : "vad");
        if (turn?.mode === "vad") {
            if (turn.threshold !== undefined) url.searchParams.set("vad_threshold", String(turn.threshold));
            if (turn.silence !== undefined) {
                url.searchParams.set("vad_silence_threshold_secs", String(turn.silence));
            }
            if (turn.minSpeech !== undefined) {
                url.searchParams.set("min_speech_duration_ms", String(Math.round(turn.minSpeech * 1000)));
            }
        }
        for (const [key, value] of Object.entries(input.providerOptions ?? {})) {
            url.searchParams.set(key, String(value));
        }

        return new ElevenLabsSTTSession(url.toString(), config.apiKey, Boolean(input.timestamps));
    }

    private constructor(url: string, apiKey: string, withTimestamps: boolean) {
        this.#withTimestamps = withTimestamps;
        this.#ws = new WebSocket(url, { headers: { "xi-api-key": apiKey } });

        this.#ws.on("message", (raw: WebSocket.RawData) => this.#receive(raw));
        this.#ws.on("error", (error) =>
            this.#queue.fail(new VoiceError(`ElevenLabs STT socket: ${String(error)}`)),
        );

        this.#closed = new Promise((resolve) => {
            this.#ws.on("close", () => {
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
        this.#send({ message_type: "input_audio_chunk", audio_base_64: encodeBase64(audio) });
    }

    /** An empty chunk with `commit` closes the turn in manual mode. */
    async flush(): Promise<void> {
        this.#send({ message_type: "input_audio_chunk", audio_base_64: "", commit: true });
    }

    /** No server-side discard exists, so this only drops the local turn. */
    cancel(): void {
        this.#tracker.endTurn();
    }

    async close(): Promise<void> {
        // The socket opens in the constructor, so a caller that closes straight
        // away arrives mid-handshake. Closing then is a no-op the `ws` library
        // drops, which would leave `closed` waiting on a socket nobody ever
        // shuts — so wait for the handshake to settle first.
        if (this.#ws.readyState === WebSocket.CONNECTING) {
            await new Promise<void>((resolve) => {
                this.#ws.once("open", () => resolve());
                this.#ws.once("close", () => resolve());
            });
        }
        if (this.#ws.readyState === WebSocket.OPEN) this.#ws.close();
        await this.#closed;
    }

    #send(message: Record<string, unknown>): void {
        if (this.#ws.readyState === WebSocket.OPEN) {
            this.#ws.send(JSON.stringify(message));
            return;
        }
        this.#ws.once("open", () => this.#ws.send(JSON.stringify(message)));
    }

    #receive(raw: WebSocket.RawData): void {
        let message: ServerMessage;
        try {
            message = JSON.parse(raw.toString()) as ServerMessage;
        } catch (error) {
            this.#queue.fail(new VoiceError(`ElevenLabs STT socket sent invalid JSON: ${String(error)}`));
            return;
        }

        switch (message.message_type) {
            case "session_started":
                this.#queue.push({ type: "metadata", requestId: message.session_id, raw: message });
                return;

            // When timestamps are on, the *_with_timestamps variants carry the
            // same text plus words, so taking both would emit each turn twice.
            case "partial_transcript":
                this.#emit(message, "partial");
                return;
            case "final_transcript":
                if (!this.#withTimestamps) this.#emit(message, "final");
                return;
            case "final_transcript_with_timestamps":
                if (this.#withTimestamps) this.#emit(message, "final");
                return;
            case "committed_transcript":
                if (!this.#withTimestamps) this.#emit(message, "turn_end");
                return;
            case "committed_transcript_with_timestamps":
                if (this.#withTimestamps) this.#emit(message, "turn_end");
                return;

            default:
                if (message.message_type.includes("error")) {
                    this.#queue.fail(
                        new VoiceError(
                            `ElevenLabs STT session: ${message.message_type}: ${message.message ?? message.error ?? ""}`,
                        ),
                    );
                }
        }
    }

    #emit(message: ServerMessage, finality: Finality): void {
        const { text, delta, turn } = this.#tracker.fromCumulative(message.text ?? "");

        this.#queue.push({
            type: "transcript",
            finality,
            text,
            delta,
            turn,
            words: toWords(message.words),
            language: message.language_code,
            raw: message,
        });

        if (finality === "turn_end") this.#tracker.endTurn();
    }
}

function toWords(words: ServerMessage["words"]): TranscriptWord[] | undefined {
    if (!words || words.length === 0) return undefined;

    return words.map((word) => ({
        text: word.text,
        start: word.start ?? 0,
        end: word.end ?? 0,
        confidence: word.logprob === undefined ? undefined : Math.exp(word.logprob),
        speaker: word.speaker_id,
        kind: word.type as TranscriptWord["kind"],
    }));
}
