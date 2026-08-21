import { describe, expect, it } from "vitest";
import type { Cartesia } from "@cartesia/cartesia-js";
import { encodeBase64 } from "@swungstudent/voice";
import { assertTTSEvent, collect, pcmRamp } from "@voice-sdk/test-kit";
import { resolveConfig } from "../src/config";
import { CartesiaTTSSession } from "../src/tts-session";

/**
 * The TTS socket is the one Cartesia surface a local server cannot stand in
 * for: the SDK hardcodes `wss:` when it builds that URL, so an http test
 * server is unreachable. The client is a constructor parameter, so the seam
 * is there - this fake records what the session asked the SDK to do.
 */
function fakeClient() {
    const messages: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;

    const calls = {
        contextOptions: undefined as Record<string, unknown> | undefined,
        pushed: [] as unknown[],
        flushed: 0,
        cancelled: 0,
        noMoreInputs: 0,
        socketClosed: 0,
    };

    const send = (message: unknown) => {
        messages.push(message);
        wake?.();
        wake = null;
    };

    const end = () => {
        ended = true;
        wake?.();
        wake = null;
    };

    const context = {
        push: async (message: unknown) => {
            calls.pushed.push(message);
        },
        flush: async () => {
            calls.flushed += 1;
        },
        cancel: async () => {
            calls.cancelled += 1;
        },
        no_more_inputs: async () => {
            calls.noMoreInputs += 1;
        },
        async *receive() {
            for (;;) {
                while (messages.length > 0) yield messages.shift();
                if (ended) return;
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
        },
    };

    const client = {
        tts: {
            websocket: async () => ({
                context: (options: Record<string, unknown>) => {
                    calls.contextOptions = options;
                    return context;
                },
                close: () => {
                    calls.socketClosed += 1;
                    end();
                },
            }),
        },
    };

    return { client: client as unknown as Cartesia, calls, send, end };
}

const CONFIG = resolveConfig({ apiKey: "k", defaultVoice: "voice-1" });

describe("CartesiaTTSSession", () => {
    describe("opening", () => {
        it("configures the context with the mapped request", async () => {
            const { client, calls } = fakeClient();

            const session = await CartesiaTTSSession.open(client, CONFIG);

            expect(calls.contextOptions).toMatchObject({
                model_id: "sonic-3.5",
                voice: { mode: "id", id: "voice-1" },
                output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
                add_timestamps: false,
                add_phoneme_timestamps: false,
            });
            // Streamed audio goes to a speaker, where a header is noise.
            expect(session.format).toEqual({
                container: "raw",
                encoding: "pcm_s16le",
                sampleRate: 44100,
                channels: 1,
            });
        });

        it("carries the model, voice and language a call names", async () => {
            const { client, calls } = fakeClient();

            await CartesiaTTSSession.open(client, CONFIG, {
                model: "sonic-2",
                voice: "voice-2",
                language: "es",
                format: { sampleRate: 24000 },
            });

            expect(calls.contextOptions).toMatchObject({
                model_id: "sonic-2",
                voice: { mode: "id", id: "voice-2" },
                language: "es",
                output_format: { sample_rate: 24000 },
            });
        });

        it("asks for the granularity of timings the caller wanted", async () => {
            const word = fakeClient();
            await CartesiaTTSSession.open(word.client, CONFIG, { timings: "word" });
            expect(word.calls.contextOptions).toMatchObject({
                add_timestamps: true,
                add_phoneme_timestamps: false,
            });

            const phoneme = fakeClient();
            await CartesiaTTSSession.open(phoneme.client, CONFIG, { timings: "phoneme" });
            expect(phoneme.calls.contextOptions).toMatchObject({
                add_timestamps: false,
                add_phoneme_timestamps: true,
            });
        });

        // Unlike speak(), here output_format sits inside the merge, so
        // providerOptions can tweak one field without dropping its siblings.
        it("lets providerOptions merge into the mapped output format", async () => {
            const { client, calls } = fakeClient();

            await CartesiaTTSSession.open(client, CONFIG, {
                format: { sampleRate: 44100 },
                providerOptions: { output_format: { sample_rate: 24000 }, max_buffer_delay_ms: 100 },
            });

            expect(calls.contextOptions).toMatchObject({
                max_buffer_delay_ms: 100,
                output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
            });
        });

        it("refuses a framed container, which the socket cannot emit", async () => {
            const { client } = fakeClient();

            await expect(
                CartesiaTTSSession.open(client, CONFIG, { format: { container: "wav" } }),
            ).rejects.toMatchObject({ name: "ValidationError", field: "format.container" });
        });

        it("refuses to guess a voice", async () => {
            const { client } = fakeClient();

            await expect(
                CartesiaTTSSession.open(client, resolveConfig({ apiKey: "k" })),
            ).rejects.toMatchObject({ name: "ValidationError", field: "voice" });
        });
    });

    describe("sending", () => {
        it("pushes the transcript with the generation config", async () => {
            const { client, calls } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG, { controls: { speed: 1.2 } });

            session.push("Hello ");
            session.push("there.");
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(calls.pushed).toEqual([
                { transcript: "Hello ", generation_config: { speed: 1.2 } },
                { transcript: "there.", generation_config: { speed: 1.2 } },
            ]);
        });

        it("sends no generation config when there are no controls", async () => {
            const { client, calls } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            session.push("hi");
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(calls.pushed).toEqual([{ transcript: "hi", generation_config: undefined }]);
        });

        it("synthesizes what is buffered on flush", async () => {
            const { client, calls } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            await session.flush();

            expect(calls.flushed).toBe(1);
        });

        it("drops queued audio on cancel, keeping the context alive", async () => {
            const { client, calls } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            session.cancel();
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(calls.cancelled).toBe(1);
            expect(calls.socketClosed).toBe(0);
        });

        it("declares the input finished and closes the socket on close", async () => {
            const { client, calls } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            await session.close();

            expect(calls.noMoreInputs).toBe(1);
            expect(calls.socketClosed).toBe(1);
            await expect(session.closed).resolves.toBeUndefined();
        });
    });

    describe("receiving", () => {
        async function eventsFrom(script: (send: (message: unknown) => void) => void) {
            const { client, send, end } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            script(send);
            end();

            const events = await collect(session.output);
            for (const event of events) assertTTSEvent(event);
            return events;
        }

        it("decodes base64 chunks into audio", async () => {
            const audio = pcmRamp(8);

            const events = await eventsFrom((send) => {
                send({ type: "chunk", data: encodeBase64(audio) });
                send({ type: "done" });
            });

            expect(events.map((event) => event.type)).toEqual(["audio", "done"]);
            expect(events[0]).toMatchObject({ data: audio });
        });

        // Cartesia returns parallel arrays; core carries spans.
        it("turns word timestamps into spans", async () => {
            const events = await eventsFrom((send) => {
                send({
                    type: "timestamps",
                    word_timestamps: { words: ["hello", "there"], start: [0, 0.5], end: [0.5, 1] },
                });
            });

            expect(events[0]).toEqual({
                type: "timing",
                alignment: {
                    unit: "word",
                    spans: [
                        { text: "hello", start: 0, end: 0.5 },
                        { text: "there", start: 0.5, end: 1 },
                    ],
                },
            });
        });

        it("turns phoneme timestamps into spans of their own unit", async () => {
            const events = await eventsFrom((send) => {
                send({
                    type: "phoneme_timestamps",
                    phoneme_timestamps: { phonemes: ["h", "E"], start: [0, 0.1], end: [0.1, 0.2] },
                });
            });

            expect(events[0]).toMatchObject({ type: "timing", alignment: { unit: "phoneme" } });
        });

        it("reports a flush landing with the id Cartesia gave it", async () => {
            const events = await eventsFrom((send) => send({ type: "flush_done", flush_id: 2 }));

            expect(events[0]).toEqual({ type: "flushed", id: 2 });
        });

        it("ignores message types core has no equivalent for", async () => {
            const events = await eventsFrom((send) => send({ type: "something_new" }));

            expect(events).toEqual([]);
        });

        it("fails the stream on an error message", async () => {
            const { client, send } = fakeClient();
            const session = await CartesiaTTSSession.open(client, CONFIG);

            send({ type: "error", title: "Bad voice", message: "no such voice id" });

            await expect(collect(session.output)).rejects.toThrow(/Bad voice: no such voice id/);
        });
    });
});
