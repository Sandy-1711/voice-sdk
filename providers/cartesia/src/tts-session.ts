import type { Cartesia } from "@cartesia/cartesia-js";
import type { RealtimeTTSInput, ResolvedAudioFormat, TTSEvent, TTSSession } from "@swungstudent/voice";
import { decodeBase64, VoiceError, withProviderOptions } from "@swungstudent/voice";
import type { ResolvedConfig } from "./config";
import { DEFAULT_STREAM_FORMAT } from "./config";
import { fromTimestamps, toGenerationConfig, toRawOutputFormat, toVoice } from "./format";

type TTSWebsocket = Awaited<ReturnType<Cartesia["tts"]["websocket"]>>;
type TTSContext = ReturnType<TTSWebsocket["context"]>;

/**
 * Push text, receive audio. Cartesia keys every message by `context_id`; one
 * session owns exactly one context, so callers never see it.
 */
export class CartesiaTTSSession implements TTSSession {
    readonly format: ResolvedAudioFormat;

    #ws: TTSWebsocket;
    #context: TTSContext;
    #generationConfig: Cartesia.GenerationConfig | undefined;
    #closed: Promise<void>;
    #onClosed!: () => void;

    static async open(
        client: Cartesia,
        config: ResolvedConfig,
        input: RealtimeTTSInput = {},
    ): Promise<CartesiaTTSSession> {
        const { payload, resolved } = toRawOutputFormat(
            input.format ?? config.defaultFormat,
            DEFAULT_STREAM_FORMAT,
        );

        const options = withProviderOptions(
            {
                model_id: (input.model ?? config.defaultModel) as Cartesia.TTSModel,
                voice: toVoice(input.voice ?? config.defaultVoice),
                output_format: payload,
                language: input.language as Cartesia.SupportedLanguage | undefined,
                add_timestamps: input.timings === true || input.timings === "word",
                add_phoneme_timestamps: input.timings === "phoneme",
            },
            input.providerOptions,
        );

        const ws = await client.tts.websocket();
        const context = ws.context(options);

        return new CartesiaTTSSession(ws, context, resolved, toGenerationConfig(input.controls));
    }

    private constructor(
        ws: TTSWebsocket,
        context: TTSContext,
        format: ResolvedAudioFormat,
        generationConfig: Cartesia.GenerationConfig | undefined,
    ) {
        this.#ws = ws;
        this.#context = context;
        this.format = format;
        this.#generationConfig = generationConfig;
        this.#closed = new Promise((resolve) => {
            this.#onClosed = resolve;
        });
    }

    get output(): AsyncIterable<TTSEvent> {
        return this.#events();
    }

    get closed(): Promise<void> {
        return this.#closed;
    }

    push(text: string): void {
        void this.#context.push({ transcript: text, generation_config: this.#generationConfig }).catch(() => {
            /* surfaced on output */
        });
    }

    async flush(): Promise<void> {
        await this.#context.flush();
    }

    cancel(): void {
        void this.#context.cancel().catch(() => {
            /* best-effort */
        });
    }

    async close(): Promise<void> {
        await this.#context.no_more_inputs().catch(() => {
            /* the socket is going away regardless */
        });
        this.#ws.close();
        this.#onClosed();
    }

    async *#events(): AsyncIterable<TTSEvent> {
        for await (const message of this.#context.receive()) {
            switch (message.type) {
                case "chunk":
                    yield { type: "audio", data: decodeBase64(message.data) };
                    break;
                case "timestamps": {
                    const timings = message.word_timestamps;
                    if (timings) {
                        yield {
                            type: "timing",
                            alignment: fromTimestamps(timings.words, timings.start, timings.end, "word"),
                        };
                    }
                    break;
                }
                case "phoneme_timestamps": {
                    const timings = message.phoneme_timestamps;
                    if (timings) {
                        yield {
                            type: "timing",
                            alignment: fromTimestamps(
                                timings.phonemes,
                                timings.start,
                                timings.end,
                                "phoneme",
                            ),
                        };
                    }
                    break;
                }
                case "flush_done":
                    yield { type: "flushed", id: message.flush_id };
                    break;
                case "done":
                    yield { type: "done" };
                    break;
                case "error":
                    throw new VoiceError(`Cartesia TTS session: ${message.title}: ${message.message}`);
            }
        }
        this.#onClosed();
    }
}
