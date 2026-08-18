import { describe, expect, it, vi } from "vitest";
import { CapabilityError, Voice } from "../src/index";
import type { AudioStream, RequestContext, SpeakResult, TranscriptResult, VoiceProvider } from "../src/index";

const AUDIO = new Uint8Array([1, 2, 3]);

const FORMAT = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
} as const;

/** Records the context each method was handed, which is what Voice adds. */
function fullProvider() {
    const seen: RequestContext[] = [];
    const stream: AudioStream = {
        format: FORMAT,
        async *[Symbol.asyncIterator]() {
            yield { data: AUDIO };
        },
    };

    const provider = {
        name: "fake",
        capabilities: { tts: true, stt: true, realtimeTTS: true, realtimeSTT: true },
        speak: vi.fn(async (_input, context?: RequestContext): Promise<SpeakResult> => {
            seen.push(context ?? {});
            return { audio: AUDIO, format: FORMAT };
        }),
        speakStream: vi.fn((_input, context?: RequestContext): AudioStream => {
            seen.push(context ?? {});
            return stream;
        }),
        transcribe: vi.fn(async (_input, context?: RequestContext): Promise<TranscriptResult> => {
            seen.push(context ?? {});
            return { text: "hello" };
        }),
        openTTSSession: vi.fn(async () => ({}) as never),
        openSTTSession: vi.fn(async () => ({}) as never),
        listVoices: vi.fn(async () => [{ id: "voice-1" }]),
        close: vi.fn(async () => {}),
    } satisfies VoiceProvider;

    return { provider, seen };
}

/** Claims nothing and implements nothing - every call must be refused. */
const bareProvider: VoiceProvider = {
    name: "bare",
    capabilities: { tts: false, stt: false, realtimeTTS: false, realtimeSTT: false },
};

describe("Voice", () => {
    it("delegates every capability to the provider", async () => {
        const { provider } = fullProvider();
        const voice = new Voice({ provider });

        expect(await voice.speak({ text: "hi" })).toEqual({ audio: AUDIO, format: FORMAT });
        expect(voice.speakStream({ text: "hi" }).format).toEqual(FORMAT);
        expect((await voice.transcribe({ audio: AUDIO })).text).toBe("hello");
        expect(await voice.listVoices()).toEqual([{ id: "voice-1" }]);

        await voice.openTTSSession();
        await voice.openSTTSession();

        expect(provider.speak).toHaveBeenCalledOnce();
        expect(provider.speakStream).toHaveBeenCalledOnce();
        expect(provider.transcribe).toHaveBeenCalledOnce();
        expect(provider.openTTSSession).toHaveBeenCalledOnce();
        expect(provider.openSTTSession).toHaveBeenCalledOnce();
        expect(provider.listVoices).toHaveBeenCalledOnce();
    });

    it("exposes the provider and the options it was built with", () => {
        const { provider } = fullProvider();
        const voice = new Voice({ provider, options: { timeout: 5000, retries: 1 } });

        expect(voice.provider).toBe(provider);
        expect(voice.options).toEqual({ timeout: 5000, retries: 1 });
    });

    it("defaults options to an empty object", () => {
        const { provider } = fullProvider();
        expect(new Voice({ provider }).options).toEqual({});
    });

    describe("capability errors", () => {
        const cases: [capability: string, call: () => unknown][] = [
            ["speak", () => new Voice({ provider: bareProvider }).speak({ text: "hi" })],
            ["speakStream", () => new Voice({ provider: bareProvider }).speakStream({ text: "hi" })],
            ["transcribe", () => new Voice({ provider: bareProvider }).transcribe({ audio: AUDIO })],
            ["openTTSSession", () => new Voice({ provider: bareProvider }).openTTSSession()],
            ["openSTTSession", () => new Voice({ provider: bareProvider }).openSTTSession()],
            ["listVoices", () => new Voice({ provider: bareProvider }).listVoices()],
        ] as const;

        for (const [capability, call] of cases) {
            it(`refuses ${capability} with the provider and capability named`, async () => {
                const error = await Promise.resolve()
                    .then(call)
                    .catch((thrown: unknown) => thrown);

                expect(error).toBeInstanceOf(CapabilityError);
                expect(error).toMatchObject({ provider: "bare", capability });
                expect((error as Error).message).toBe(`Provider "bare" does not support "${capability}".`);
            });
        }
    });

    describe("request context", () => {
        it("passes the constructor defaults down", async () => {
            const { provider, seen } = fullProvider();
            const voice = new Voice({ provider, options: { timeout: 1000, retries: 3 } });

            await voice.speak({ text: "hi" });

            expect(seen[0]).toEqual({ timeout: 1000, retries: 3 });
        });

        it("lets a per-call context win over the defaults", async () => {
            const { provider, seen } = fullProvider();
            const voice = new Voice({ provider, options: { timeout: 1000, retries: 3 } });
            const signal = AbortSignal.abort();

            await voice.speak({ text: "hi" }, { timeout: 50, signal });

            expect(seen[0]).toEqual({ timeout: 50, retries: 3, signal });
        });

        it("reaches speakStream and transcribe too", async () => {
            const { provider, seen } = fullProvider();
            const voice = new Voice({ provider, options: { timeout: 1000 } });

            voice.speakStream({ text: "hi" });
            await voice.transcribe({ audio: AUDIO }, { retries: 9 });

            expect(seen[0]).toEqual({ timeout: 1000, retries: undefined });
            expect(seen[1]).toEqual({ timeout: 1000, retries: 9 });
        });

        it("does not reach the session openers, which are connection-scoped", async () => {
            const { provider } = fullProvider();
            const voice = new Voice({ provider, options: { timeout: 1000 } });

            await voice.openTTSSession({ voice: "v" });

            expect(provider.openTTSSession).toHaveBeenCalledWith({ voice: "v" });
        });
    });

    describe("close", () => {
        it("closes the provider when it can be closed", async () => {
            const { provider } = fullProvider();
            await new Voice({ provider }).close();
            expect(provider.close).toHaveBeenCalledOnce();
        });

        it("is a no-op for a provider that holds nothing open", async () => {
            await expect(new Voice({ provider: bareProvider }).close()).resolves.toBeUndefined();
        });
    });
});
