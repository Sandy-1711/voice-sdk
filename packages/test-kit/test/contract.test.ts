import { describe, expect, it } from "vitest";
import type { Finality, STTEvent, TTSEvent, VoiceProvider } from "@swungstudent/voice";
import {
    assertCapabilityInvariants,
    assertClosesOnAbort,
    assertSTTEvent,
    assertTTSEvent,
    assertTurnSequence,
} from "../src/index";

/**
 * Every assertion here gets a case that makes it throw, not just one that lets
 * it pass. A contract assertion that cannot fail is worse than none: it makes
 * every provider suite look green while proving nothing.
 */

const CAPABLE = { tts: true, stt: true, realtimeTTS: true, realtimeSTT: true };

function provider(overrides: Partial<VoiceProvider> = {}): VoiceProvider {
    return {
        name: "fake",
        capabilities: CAPABLE,
        speak: async () => ({}) as never,
        speakStream: () => ({}) as never,
        transcribe: async () => ({}) as never,
        openTTSSession: async () => ({}) as never,
        openSTTSession: async () => ({}) as never,
        ...overrides,
    };
}

describe("assertCapabilityInvariants", () => {
    it("passes a provider whose flags match its methods", () => {
        expect(() => assertCapabilityInvariants(provider())).not.toThrow();
    });

    it("passes a provider that claims nothing and implements nothing", () => {
        expect(() =>
            assertCapabilityInvariants({
                name: "bare",
                capabilities: { tts: false, stt: false, realtimeTTS: false, realtimeSTT: false },
            }),
        ).not.toThrow();
    });

    it("rejects a claimed capability with no method behind it", () => {
        expect(() => assertCapabilityInvariants(provider({ transcribe: undefined }))).toThrow(
            /"fake" claims stt but has no transcribe\(\)/,
        );
    });

    it("names the missing method when a capability has two", () => {
        expect(() => assertCapabilityInvariants(provider({ speakStream: undefined }))).toThrow(
            /claims tts but has no speakStream\(\)/,
        );
    });

    // The other direction matters just as much: a method behind a false flag is
    // unreachable through Voice, which throws CapabilityError before it.
    it("rejects a method the flags say is not there", () => {
        expect(() =>
            assertCapabilityInvariants(provider({ capabilities: { ...CAPABLE, realtimeSTT: false } })),
        ).toThrow(/implements openSTTSession\(\) but reports realtimeSTT: false/);
    });

    it("rejects a provider with no name", () => {
        expect(() => assertCapabilityInvariants(provider({ name: "" }))).toThrow(
            /provider\.name must be a non-empty string/,
        );
    });

    it("rejects a flag that is not a boolean", () => {
        const broken = provider({
            capabilities: { ...CAPABLE, tts: "yes" as unknown as boolean },
        });

        expect(() => assertCapabilityInvariants(broken)).toThrow(/capabilities\.tts must be a boolean/);
    });
});

describe("assertClosesOnAbort", () => {
    /** A session that behaves: refuses a spent signal, closes when aborted. */
    function wellBehaved(signal: AbortSignal) {
        signal.throwIfAborted();
        let settle!: () => void;
        const closed = new Promise<void>((resolve) => (settle = resolve));
        signal.addEventListener("abort", () => settle(), { once: true });
        return Promise.resolve({ closed });
    }

    it("passes a session that honours its signal", async () => {
        await expect(assertClosesOnAbort(wellBehaved)).resolves.toBeUndefined();
    });

    it("rejects a session that opens on a signal already aborted", async () => {
        const opensAnyway = (signal: AbortSignal) => {
            let settle!: () => void;
            const closed = new Promise<void>((resolve) => (settle = resolve));
            signal.addEventListener("abort", () => settle(), { once: true });
            return Promise.resolve({ closed });
        };

        await expect(assertClosesOnAbort(opensAnyway)).rejects.toThrow(
            /already-aborted signal must be refused/,
        );
    });

    // The bug this whole assertion exists for: two providers accepted `signal`
    // and ignored it, and every suite stayed green.
    it("rejects a session that ignores the abort", async () => {
        const ignores = (signal: AbortSignal) => {
            signal.throwIfAborted();
            return Promise.resolve({ closed: new Promise<void>(() => {}) });
        };

        await expect(assertClosesOnAbort(ignores, undefined, 50)).rejects.toThrow(
            /did not close the session within 50ms/,
        );
    });

    it("runs hangUp for a provider whose close waits on the server", async () => {
        let hungUp = false;
        const needsHangUp = (signal: AbortSignal) => {
            signal.throwIfAborted();
            return Promise.resolve({
                closed: new Promise<void>((resolve) => {
                    signal.addEventListener("abort", () => {
                        const wait = setInterval(() => {
                            if (!hungUp) return;
                            clearInterval(wait);
                            resolve();
                        }, 5);
                    });
                }),
            });
        };

        await expect(assertClosesOnAbort(needsHangUp, () => (hungUp = true))).resolves.toBeUndefined();
    });
});

describe("assertTTSEvent", () => {
    const legal: TTSEvent[] = [
        { type: "audio", data: new Uint8Array([1]), offset: 0 },
        { type: "timing", alignment: { unit: "word", spans: [{ text: "hi", start: 0, end: 0.4 }] } },
        { type: "flushed", id: 3 },
        { type: "cleared", id: "ctx-1" },
        { type: "done" },
        { type: "metadata", requestId: "req-1", model: "sonic" },
        { type: "warning", message: "clipped", code: "W1" },
    ];

    it.each(legal)("passes a legal $type event", (event) => {
        expect(() => assertTTSEvent(event)).not.toThrow();
    });

    it("rejects a type core has no member for", () => {
        expect(() => assertTTSEvent({ type: "chunk" } as unknown as TTSEvent)).toThrow(
            /Unknown TTS event type: "chunk"/,
        );
    });

    // Base64 that was never decoded is the mistake here, and a string would sail
    // through anything looser than an instanceof.
    it("rejects audio that is not bytes", () => {
        expect(() => assertTTSEvent({ type: "audio", data: "AQID" } as unknown as TTSEvent)).toThrow(
            /audio\.data must be a Uint8Array/,
        );
    });

    it("rejects a non-numeric offset", () => {
        expect(() =>
            assertTTSEvent({ type: "audio", data: new Uint8Array(), offset: "0" } as unknown as TTSEvent),
        ).toThrow(/audio\.offset must be a number or undefined/);
    });

    it("rejects an id that is neither string nor number", () => {
        expect(() => assertTTSEvent({ type: "flushed", id: { n: 1 } } as unknown as TTSEvent)).toThrow(
            /flushed\.id must be a string, a number or undefined/,
        );
    });

    it("rejects a warning with no message", () => {
        expect(() => assertTTSEvent({ type: "warning" } as unknown as TTSEvent)).toThrow(
            /warning\.message must be a string/,
        );
    });

    it("rejects metadata fields of the wrong type", () => {
        expect(() => assertTTSEvent({ type: "metadata", requestId: 7 } as unknown as TTSEvent)).toThrow(
            /metadata\.requestId must be a string or undefined/,
        );
    });

    describe("alignment", () => {
        const timing = (alignment: unknown) => ({ type: "timing", alignment }) as unknown as TTSEvent;

        it("rejects a unit core does not model", () => {
            expect(() => assertTTSEvent(timing({ unit: "syllable", spans: [] }))).toThrow(
                /alignment\.unit must be word \| character \| phoneme/,
            );
        });

        it("rejects spans that are not an array", () => {
            expect(() => assertTTSEvent(timing({ unit: "word", spans: {} }))).toThrow(
                /alignment\.spans must be an array/,
            );
        });

        // Off-by-one in a start/end mapping shows up exactly here.
        it("rejects a span that ends before it starts", () => {
            expect(() =>
                assertTTSEvent(timing({ unit: "word", spans: [{ text: "hi", start: 1, end: 0.5 }] })),
            ).toThrow(/span "hi" ends \(0\.5\) before it starts \(1\)/);
        });

        it("rejects span bounds that are not numbers", () => {
            expect(() =>
                assertTTSEvent(timing({ unit: "word", spans: [{ text: "hi", start: "0", end: 1 }] })),
            ).toThrow(/span\.start\/end must be numbers/);
        });

        it("rejects span text that is not a string", () => {
            expect(() =>
                assertTTSEvent(timing({ unit: "word", spans: [{ text: 1, start: 0, end: 1 }] })),
            ).toThrow(/span\.text must be a string/);
        });
    });
});

describe("assertSTTEvent", () => {
    const transcript = (overrides: Record<string, unknown> = {}) =>
        ({
            type: "transcript",
            finality: "final",
            text: "book a table",
            delta: " table",
            turn: 0,
            ...overrides,
        }) as unknown as STTEvent;

    const legal: STTEvent[] = [
        transcript(),
        { type: "speech_started", at: 0.2 },
        { type: "speech_ended" },
        { type: "metadata", requestId: "req-1" },
        { type: "warning", message: "low confidence" },
    ];

    it.each(legal)("passes a legal $type event", (event) => {
        expect(() => assertSTTEvent(event)).not.toThrow();
    });

    it("rejects a type core has no member for", () => {
        expect(() => assertSTTEvent({ type: "Results" } as unknown as STTEvent)).toThrow(
            /Unknown STT event type: "Results"/,
        );
    });

    // Every provider spells finality differently, so this is the assertion that
    // catches a mapping that passed the wire value straight through.
    it("rejects a finality core does not model", () => {
        expect(() => assertSTTEvent(transcript({ finality: "is_final" }))).toThrow(
            /transcript\.finality must be partial \| final \| turn_end, got "is_final"/,
        );
    });

    it("rejects a missing text or delta", () => {
        expect(() => assertSTTEvent(transcript({ text: undefined }))).toThrow(
            /transcript\.text must be a string/,
        );
        expect(() => assertSTTEvent(transcript({ delta: undefined }))).toThrow(
            /transcript\.delta must be a string/,
        );
    });

    it("rejects a turn that is not a whole number, or is negative", () => {
        expect(() => assertSTTEvent(transcript({ turn: 1.5 }))).toThrow(
            /transcript\.turn must be a non-negative integer/,
        );
        expect(() => assertSTTEvent(transcript({ turn: -1 }))).toThrow(
            /transcript\.turn must be a non-negative integer/,
        );
    });

    it("rejects non-numeric timings", () => {
        expect(() => assertSTTEvent(transcript({ start: "0" }))).toThrow(
            /transcript\.start must be a number or undefined/,
        );
    });

    it("rejects a malformed word", () => {
        expect(() => assertSTTEvent(transcript({ words: [{ text: "hi", start: 0 }] }))).toThrow(
            /word\.end must be a number/,
        );
        expect(() => assertSTTEvent(transcript({ words: [{ start: 0, end: 1 }] }))).toThrow(
            /word\.text must be a string/,
        );
    });

    it("rejects a bad speech marker or warning", () => {
        expect(() => assertSTTEvent({ type: "speech_started", at: "0.2" } as unknown as STTEvent)).toThrow(
            /speech_started\.at must be a number or undefined/,
        );
        expect(() => assertSTTEvent({ type: "warning" } as unknown as STTEvent)).toThrow(
            /warning\.message must be a string/,
        );
    });
});

describe("assertTurnSequence", () => {
    const t = (turn: number, finality: Finality) =>
        ({ type: "transcript", finality, text: "", delta: "", turn }) as STTEvent;

    it("passes turns that advance only after a turn_end", () => {
        expect(() =>
            assertTurnSequence([
                t(0, "partial"),
                t(0, "final"),
                t(0, "turn_end"),
                t(1, "partial"),
                t(1, "turn_end"),
            ]),
        ).not.toThrow();
    });

    it("ignores events that are not transcripts", () => {
        expect(() =>
            assertTurnSequence([{ type: "speech_started" }, t(0, "partial"), { type: "speech_ended" }]),
        ).not.toThrow();
    });

    // A turn counter that ticks on the wrong event lands here.
    it("rejects a turn that advances without a turn_end", () => {
        expect(() => assertTurnSequence([t(0, "final"), t(1, "partial")])).toThrow(
            /turn jumped from 0 to 1 without a turn_end/,
        );
    });

    it("rejects a turn that skips a number", () => {
        expect(() => assertTurnSequence([t(0, "turn_end"), t(2, "partial")])).toThrow(
            /turn jumped from 0 to 2/,
        );
    });

    it("rejects a turn that goes backwards", () => {
        expect(() => assertTurnSequence([t(0, "turn_end"), t(1, "turn_end"), t(0, "partial")])).toThrow(
            /turn jumped from 1 to 0/,
        );
    });

    // One turn_end permits exactly one advance, not a free-for-all after it.
    it("rejects a second advance on one turn_end", () => {
        expect(() => assertTurnSequence([t(0, "turn_end"), t(1, "partial"), t(2, "partial")])).toThrow(
            /turn jumped from 1 to 2 without a turn_end/,
        );
    });
});
