import { describe, expect, it } from "vitest";
import { ValidationError } from "@voice-sdk/core";
import type { ResolvedAudioFormat } from "@voice-sdk/core";
import {
    assertNoTimings,
    fromWords,
    toOutputFormat,
    toRealtimeOutputFormat,
    toRealtimeSTTFormat,
    toSTTFormat,
    toSpeed,
} from "../src/format";

const FALLBACK: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 24000,
    channels: 1,
};

describe("toOutputFormat", () => {
    it("falls back field by field when the caller asks for nothing", () => {
        expect(toOutputFormat(undefined, FALLBACK)).toEqual({
            params: { encoding: "linear16", container: "none", sample_rate: 24000 },
            resolved: { container: "raw", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 },
        });
    });

    it("lets a partial request override only what it names", () => {
        const { params, resolved } = toOutputFormat({ sampleRate: 48000 }, FALLBACK);

        expect(params).toEqual({ encoding: "linear16", container: "none", sample_rate: 48000 });
        expect(resolved.encoding).toBe("pcm_s16le");
    });

    // Deepgram spells the absence of a container "none", not by omitting it.
    it("maps the raw container to none", () => {
        expect(toOutputFormat({ container: "raw" }, FALLBACK).params.container).toBe("none");
    });

    it("keeps a wav container, which Deepgram frames itself", () => {
        expect(toOutputFormat({ container: "wav" }, FALLBACK)).toEqual({
            params: { encoding: "linear16", container: "wav", sample_rate: 24000 },
            resolved: { container: "wav", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 },
        });
    });

    it("maps the telephony codecs", () => {
        expect(toOutputFormat({ container: "raw", encoding: "mulaw", sampleRate: 8000 }, FALLBACK).params).toEqual({
            encoding: "mulaw",
            container: "none",
            sample_rate: 8000,
        });
        expect(toOutputFormat({ container: "raw", encoding: "alaw", sampleRate: 8000 }, FALLBACK).params.encoding).toBe("alaw");
    });

    describe("self-framing containers ride the none container", () => {
        it("mp3 carries a bitrate in bits per second", () => {
            expect(toOutputFormat({ container: "mp3", bitrate: 48 }, FALLBACK)).toEqual({
                params: { encoding: "mp3", container: "none", sample_rate: 24000, bit_rate: 48_000 },
                resolved: { container: "mp3", encoding: "mp3", sampleRate: 24000, channels: 1, bitrate: 48 },
            });
        });

        it("aac carries a bitrate too", () => {
            expect(toOutputFormat({ container: "aac", bitrate: 64 }, FALLBACK).params).toEqual({
                encoding: "aac",
                container: "none",
                sample_rate: 24000,
                bit_rate: 64_000,
            });
        });

        it("flac takes no bitrate", () => {
            expect(toOutputFormat({ container: "flac" }, FALLBACK).params).toEqual({
                encoding: "flac",
                container: "none",
                sample_rate: 24000,
            });
        });

        it("leaves bit_rate unset when no bitrate was asked for", () => {
            expect(toOutputFormat({ container: "mp3" }, FALLBACK).params.bit_rate).toBeUndefined();
        });
    });

    it("maps ogg to opus in an ogg container", () => {
        expect(toOutputFormat({ container: "ogg", bitrate: 32 }, FALLBACK)).toEqual({
            params: { encoding: "opus", container: "ogg", sample_rate: 24000, bit_rate: 32_000 },
            resolved: { container: "ogg", encoding: "opus", sampleRate: 24000, channels: 1, bitrate: 32 },
        });
    });

    describe("rejects what Deepgram cannot produce", () => {
        it("names format.channels for anything but mono", () => {
            expect(() => toOutputFormat({ channels: 2 }, FALLBACK)).toThrowError(
                expect.objectContaining({
                    name: "ValidationError",
                    provider: "deepgram",
                    field: "format.channels",
                    message: expect.stringContaining("only generates mono"),
                }),
            );
        });

        it("names format.sampleRate for an unsupported rate", () => {
            const thrown = catchError(() => toOutputFormat({ sampleRate: 44100 }, FALLBACK));

            expect(thrown).toBeInstanceOf(ValidationError);
            expect(thrown).toMatchObject({ field: "format.sampleRate" });
            // The supported list belongs in the message, or the caller has to guess.
            expect((thrown as Error).message).toContain("8000, 16000, 24000, 32000, 48000");
        });

        it("names format.container for a container it has no encoder for", () => {
            expect(catchError(() => toOutputFormat({ container: "webm" }, FALLBACK))).toMatchObject({
                field: "format.container",
            });
        });

        it("names format.encoding for a codec that cannot be headerless", () => {
            expect(catchError(() => toOutputFormat({ container: "raw", encoding: "opus" }, FALLBACK))).toMatchObject({
                field: "format.encoding",
                message: expect.stringContaining("pcm_s16le, mulaw, alaw"),
            });
        });
    });
});

describe("toRealtimeOutputFormat", () => {
    it("drops the container, which the synthesis socket rejects", () => {
        expect(toRealtimeOutputFormat(undefined, FALLBACK)).toEqual({
            params: { encoding: "linear16", sample_rate: 24000 },
            resolved: { container: "raw", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 },
        });
    });

    it("carries mulaw through at telephony rates", () => {
        expect(toRealtimeOutputFormat({ encoding: "mulaw", sampleRate: 8000 }, FALLBACK).params).toEqual({
            encoding: "mulaw",
            sample_rate: 8000,
        });
    });

    it("points a caller asking for a container at speak() instead", () => {
        const thrown = catchError(() => toRealtimeOutputFormat({ container: "wav" }, FALLBACK));

        expect(thrown).toMatchObject({ field: "format.container" });
        expect((thrown as Error).message).toContain("speak()");
    });

    it("rejects a containerized codec before it reaches the socket", () => {
        expect(catchError(() => toRealtimeOutputFormat({ container: "mp3" }, FALLBACK))).toMatchObject({
            field: "format.container",
        });
    });
});

describe("toSTTFormat", () => {
    it("sends nothing when there is a header for Deepgram to sniff", () => {
        expect(toSTTFormat(undefined)).toEqual({});
        expect(toSTTFormat({ sampleRate: 16000 })).toEqual({});
        expect(toSTTFormat({ container: "wav", encoding: "pcm_s16le", sampleRate: 16000 })).toEqual({});
    });

    it("names the codec for headerless audio", () => {
        expect(toSTTFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 16000 })).toEqual({
            encoding: "linear16",
            sample_rate: 16000,
        });
    });

    it("treats an unstated container as headerless", () => {
        expect(toSTTFormat({ encoding: "mulaw", sampleRate: 8000 })).toEqual({
            encoding: "mulaw",
            sample_rate: 8000,
        });
    });

    it("maps the wider set of input codecs Deepgram accepts", () => {
        expect(toSTTFormat({ encoding: "pcm_s32le", sampleRate: 48000 }).encoding).toBe("linear32");
        expect(toSTTFormat({ encoding: "flac", sampleRate: 48000 }).encoding).toBe("flac");
        expect(toSTTFormat({ encoding: "opus", sampleRate: 48000 }).encoding).toBe("opus");
    });

    it("refuses headerless audio with no sample rate, which Deepgram cannot infer", () => {
        expect(catchError(() => toSTTFormat({ container: "raw", encoding: "pcm_s16le" }))).toMatchObject({
            field: "format.sampleRate",
        });
    });

    it("names format.encoding for a codec with no equivalent", () => {
        expect(catchError(() => toSTTFormat({ encoding: "mp3", sampleRate: 44100 }))).toMatchObject({
            field: "format.encoding",
        });
    });
});

describe("toRealtimeSTTFormat", () => {
    it("always names both fields, since a live socket has nothing to sniff", () => {
        expect(toRealtimeSTTFormat(undefined, FALLBACK)).toEqual({ encoding: "linear16", sample_rate: 24000 });
    });

    it("prefers what the caller asked for", () => {
        expect(toRealtimeSTTFormat({ encoding: "mulaw", sampleRate: 8000 }, FALLBACK)).toEqual({
            encoding: "mulaw",
            sample_rate: 8000,
        });
    });

    it("mixes a partial request with the fallback", () => {
        expect(toRealtimeSTTFormat({ sampleRate: 16000 }, FALLBACK)).toEqual({
            encoding: "linear16",
            sample_rate: 16000,
        });
    });
});

describe("toSpeed", () => {
    it("passes speed through and ignores the controls Deepgram has no knob for", () => {
        expect(toSpeed({ speed: 1.2 })).toBe(1.2);
        expect(toSpeed({ volume: 2, stability: 0.5, emotion: "happy" })).toBeUndefined();
        expect(toSpeed(undefined)).toBeUndefined();
    });
});

describe("assertNoTimings", () => {
    it("allows the absence of a request for timings", () => {
        expect(() => assertNoTimings(undefined)).not.toThrow();
        expect(() => assertNoTimings(false)).not.toThrow();
    });

    it("refuses every granularity, rather than returning audio with no alignment", () => {
        for (const timings of [true, "word", "character", "phoneme"] as const) {
            expect(catchError(() => assertNoTimings(timings))).toMatchObject({
                name: "ValidationError",
                field: "timings",
            });
        }
    });
});

describe("fromWords", () => {
    it("has nothing to report when Deepgram sent no words", () => {
        expect(fromWords(undefined)).toBeUndefined();
        expect(fromWords([])).toBeUndefined();
    });

    it("maps the wire shape onto core's", () => {
        expect(
            fromWords([{ word: "hello", start: 0.1, end: 0.4, confidence: 0.99, punctuated_word: "Hello," }]),
        ).toEqual([
            { text: "hello", start: 0.1, end: 0.4, confidence: 0.99, punctuated: "Hello,", speaker: undefined },
        ]);
    });

    // Speaker 0 is a real speaker, so it must not be dropped as falsy.
    it("keeps speaker zero and stringifies the index", () => {
        const words = fromWords([
            { word: "a", start: 0, end: 1, speaker: 0 },
            { word: "b", start: 1, end: 2, speaker: 1 },
        ]);

        expect(words?.map((word) => word.speaker)).toEqual(["0", "1"]);
    });

    it("defaults the fields Deepgram left off", () => {
        expect(fromWords([{}])).toEqual([
            { text: "", start: 0, end: 0, confidence: undefined, punctuated: undefined, speaker: undefined },
        ]);
    });
});

function catchError(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }
    throw new Error("Expected the call to throw, but it returned.");
}
