import { describe, expect, it, vi } from "vitest";
import { Voice } from "../src/index";
import type {
    AudioStream,
    SpeakResult,
    STTSession,
    TranscriptResult,
    TTSSession,
    VoiceMiddleware,
    VoiceProvider,
} from "../src/index";
import { collect } from "./helpers";

const AUDIO = new Uint8Array([1, 2, 3]);

const FORMAT = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
} as const;

function provider(): VoiceProvider {
    const stream: AudioStream = {
        format: FORMAT,
        async *[Symbol.asyncIterator]() {
            yield { data: AUDIO };
        },
    };

    return {
        name: "fake",
        capabilities: { tts: true, stt: true, realtimeTTS: true, realtimeSTT: true },
        speak: async (input): Promise<SpeakResult> => ({
            audio: new TextEncoder().encode(input.text),
            format: FORMAT,
        }),
        speakStream: () => stream,
        transcribe: async (): Promise<TranscriptResult> => ({ text: "hello there" }),
        openTTSSession: async (): Promise<TTSSession> => ({ ...session(), format: FORMAT }),
        openSTTSession: async (): Promise<STTSession> => session(),
        listVoices: async () => [{ id: "voice-1" }],
    };
}

/**
 * The capability flags claim both realtime modes, and `Voice` gates on method
 * presence — so without these the session hooks throw before any middleware runs.
 */
function session() {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await
        output: (async function* () {})(),
        push: () => {},
        flush: async () => {},
        cancel: () => {},
        close: async () => {},
        closed: Promise.resolve(),
    };
}

function logger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("operation middleware", () => {
    it("runs the first entry outermost", async () => {
        const order: string[] = [];
        const tag = (name: string): VoiceMiddleware => ({
            async speak(input, _call, next) {
                order.push(`${name} in`);
                const result = await next(input);
                order.push(`${name} out`);
                return result;
            },
        });

        const voice = new Voice({ provider: provider(), middleware: [tag("a"), tag("b")] });
        await voice.speak({ text: "hi" });

        expect(order).toEqual(["a in", "b in", "b out", "a out"]);
    });

    it("lets a hook rewrite the input on the way down", async () => {
        const middleware: VoiceMiddleware = {
            speak: (input, _call, next) => next({ ...input, text: input.text.toUpperCase() }),
        };

        const voice = new Voice({ provider: provider(), middleware: [middleware] });
        const result = await voice.speak({ text: "hi" });

        expect(new TextDecoder().decode(result.audio)).toBe("HI");
    });

    it("lets a hook rewrite the result on the way back up", async () => {
        const middleware: VoiceMiddleware = {
            async transcribe(input, _call, next) {
                const result = await next(input);
                return { ...result, text: result.text.trim().toUpperCase() };
            },
        };

        const voice = new Voice({ provider: provider(), middleware: [middleware] });

        await expect(voice.transcribe({ audio: AUDIO })).resolves.toMatchObject({ text: "HELLO THERE" });
    });

    it("tells the hook which provider and operation it is wrapping", async () => {
        const seen: unknown[] = [];
        const middleware: VoiceMiddleware = {
            speak: (input, call, next) => {
                seen.push(call);
                return next(input);
            },
        };

        const voice = new Voice({
            provider: provider(),
            options: { timeout: 5000 },
            middleware: [middleware],
        });
        await voice.speak({ text: "hi" });

        expect(seen[0]).toMatchObject({
            provider: "fake",
            operation: "speak",
            context: { timeout: 5000 },
        });
    });

    it("leaves operations a middleware does not define untouched", async () => {
        const speak = vi.fn((input, _call, next) => next(input));
        const voice = new Voice({ provider: provider(), middleware: [{ speak }] });

        await expect(voice.transcribe({ audio: AUDIO })).resolves.toMatchObject({ text: "hello there" });
        expect(speak).not.toHaveBeenCalled();
    });

    it("wraps speakStream synchronously, since it returns a stream not a promise", async () => {
        const middleware: VoiceMiddleware = {
            speakStream(input, _call, next) {
                const inner = next(input);
                return {
                    format: inner.format,
                    async *[Symbol.asyncIterator]() {
                        for await (const chunk of inner) yield { ...chunk, data: chunk.data.slice(0, 1) };
                    },
                };
            },
        };

        const voice = new Voice({ provider: provider(), middleware: [middleware] });
        const chunks = await collect(voice.speakStream({ text: "hi" }));

        expect(chunks[0]?.data).toEqual(new Uint8Array([1]));
    });

    it("wraps listVoices, which takes no input", async () => {
        const middleware: VoiceMiddleware = {
            async listVoices(_call, next) {
                return [...(await next()), { id: "extra" }];
            },
        };

        const voice = new Voice({ provider: provider(), middleware: [middleware] });

        await expect(voice.listVoices()).resolves.toEqual([{ id: "voice-1" }, { id: "extra" }]);
    });

    it("lets an error from the provider reach the outer hook", async () => {
        const failing = { ...provider(), speak: async () => Promise.reject(new Error("upstream")) };
        const caught: unknown[] = [];
        const middleware: VoiceMiddleware = {
            async speak(input, _call, next) {
                try {
                    return await next(input);
                } catch (error) {
                    caught.push(error);
                    throw error;
                }
            },
        };

        const voice = new Voice({ provider: failing, middleware: [middleware] });

        await expect(voice.speak({ text: "hi" })).rejects.toThrow("upstream");
        expect(caught).toHaveLength(1);
    });

    it("still refuses an operation the provider does not have", async () => {
        const bare: VoiceProvider = {
            name: "bare",
            capabilities: { tts: false, stt: false, realtimeTTS: false, realtimeSTT: false },
        };
        const speak = vi.fn();
        const voice = new Voice({ provider: bare, middleware: [{ speak }] });

        await expect(voice.speak({ text: "hi" })).rejects.toThrow(/does not support/);
        // The capability check comes first, so no hook sees a call that cannot happen.
        expect(speak).not.toHaveBeenCalled();
    });
});

describe("the built-in logger", () => {
    it("reports what was asked for, not just that a call happened", async () => {
        const log = logger();
        const voice = new Voice({ provider: provider(), options: { logger: log } });

        await voice.speak({ text: "hello", model: "m1", voice: "v1" });

        const lines = log.debug.mock.calls.map(([line]) => String(line));
        expect(lines[0]).toContain("5 chars");
        expect(lines[0]).toContain("model=m1");
        expect(lines[0]).toContain("voice=v1");
        expect(lines[1]).toMatch(/ok in \d+ms/);
    });

    it("reports a failure at error level and rethrows", async () => {
        const log = logger();
        const failing = { ...provider(), speak: async () => Promise.reject(new Error("upstream")) };
        const voice = new Voice({ provider: failing, options: { logger: log } });

        await expect(voice.speak({ text: "hi" })).rejects.toThrow("upstream");
        expect(log.error.mock.calls[0]?.[0]).toContain("upstream");
    });

    it("stays off when no logger is configured", async () => {
        const log = logger();
        const voice = new Voice({ provider: provider() });

        await voice.speak({ text: "hi" });

        expect(log.debug).not.toHaveBeenCalled();
    });

    it("runs innermost, so caller middleware wraps it", async () => {
        const log = logger();
        const order: string[] = [];
        const middleware: VoiceMiddleware = {
            async speak(input, _call, next) {
                order.push("caller in");
                const result = await next(input);
                order.push("caller out");
                return result;
            },
        };

        const voice = new Voice({ provider: provider(), options: { logger: log }, middleware: [middleware] });
        await voice.speak({ text: "hi" });

        expect(order).toEqual(["caller in", "caller out"]);
        expect(log.debug).toHaveBeenCalled();
    });

    it("names the voice and model on speakStream, the same as speak", () => {
        const log = logger();
        const voice = new Voice({ provider: provider(), options: { logger: log } });

        voice.speakStream({ text: "hello", model: "m1", voice: "v1" });

        const line = String(log.debug.mock.calls[0]?.[0]);
        expect(line).toContain("speakStream");
        expect(line).toContain("5 chars");
        expect(line).toContain("model=m1");
    });

    it("reports a speakStream that fails while opening, which used to pass silently", () => {
        const log = logger();
        const failing = {
            ...provider(),
            speakStream: () => {
                throw new Error("no socket");
            },
        };
        const voice = new Voice({ provider: failing, options: { logger: log } });

        expect(() => voice.speakStream({ text: "hi" })).toThrow("no socket");
        expect(String(log.error.mock.calls[0]?.[0])).toContain("no socket");
    });

    it("reports the transcript length, not just that transcribe returned", async () => {
        const log = logger();
        const voice = new Voice({ provider: provider(), options: { logger: log } });

        await voice.transcribe({ audio: AUDIO, model: "m1", language: "en" });

        const lines = log.debug.mock.calls.map(([line]) => String(line));
        expect(lines[0]).toContain("model=m1");
        expect(lines[0]).toContain("language=en");
        expect(lines[1]).toContain("11 chars");
    });

    it("reports how many voices listVoices found", async () => {
        const log = logger();
        const voice = new Voice({ provider: provider(), options: { logger: log } });

        await voice.listVoices();

        expect(String(log.debug.mock.calls[0]?.[0])).toContain("1 voices");
    });

    it.each([
        ["openTTSSession", (v: Voice<VoiceProvider>) => v.openTTSSession()],
        ["openSTTSession", (v: Voice<VoiceProvider>) => v.openSTTSession()],
    ])("times %s", async (operation, open) => {
        const log = logger();
        const voice = new Voice({ provider: provider(), options: { logger: log } });

        await open(voice);

        expect(String(log.debug.mock.calls[0]?.[0])).toMatch(new RegExp(`fake\\.${operation} ok in \\d+ms`));
    });

    it.each([
        ["transcribe", (v: Voice<VoiceProvider>) => v.transcribe({ audio: AUDIO })],
        ["openTTSSession", (v: Voice<VoiceProvider>) => v.openTTSSession()],
        ["openSTTSession", (v: Voice<VoiceProvider>) => v.openSTTSession()],
        ["listVoices", (v: Voice<VoiceProvider>) => v.listVoices()],
    ])("reports a failing %s at error level and rethrows", async (operation, call) => {
        const log = logger();
        const failing = {
            ...provider(),
            [operation]: () => Promise.reject(new Error("upstream")),
        } as VoiceProvider;
        const voice = new Voice({ provider: failing, options: { logger: log } });

        await expect(call(voice)).rejects.toThrow("upstream");
        const line = String(log.error.mock.calls[0]?.[0]);
        expect(line).toContain(operation);
        expect(line).toContain("upstream");
    });
});
