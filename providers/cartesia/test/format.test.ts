import { describe, expect, it } from "vitest";
import type { ResolvedAudioFormat } from "@swungstudent/voice";
import {
    fromTimestamps,
    fromWords,
    toGenerationConfig,
    toOutputFormat,
    toRawOutputFormat,
    toRequestOptions,
    toSTTEncoding,
    toVoice,
} from "../src/format";

const FALLBACK: ResolvedAudioFormat = {
    container: "raw",
    encoding: "pcm_s16le",
    sampleRate: 44100,
    channels: 1,
};

describe("toOutputFormat", () => {
    it("falls back field by field when the caller asks for nothing", () => {
        expect(toOutputFormat(undefined, FALLBACK)).toEqual({
            payload: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
            resolved: { container: "raw", encoding: "pcm_s16le", sampleRate: 44100, channels: 1 },
        });
    });

    // Core names the bare codec; Cartesia prefixes everything with pcm_.
    it("prefixes the telephony codecs the way Cartesia spells them", () => {
        expect(
            toOutputFormat({ container: "raw", encoding: "mulaw", sampleRate: 8000 }, FALLBACK).payload,
        ).toEqual({
            container: "raw",
            encoding: "pcm_mulaw",
            sample_rate: 8000,
        });
        expect(
            toOutputFormat({ container: "raw", encoding: "alaw", sampleRate: 8000 }, FALLBACK).payload,
        ).toMatchObject({
            encoding: "pcm_alaw",
        });
        expect(toOutputFormat({ container: "raw", encoding: "pcm_f32le" }, FALLBACK).payload).toMatchObject({
            encoding: "pcm_f32le",
        });
    });

    it("keeps the encoding for a wav container, which Cartesia frames itself", () => {
        expect(toOutputFormat({ container: "wav", sampleRate: 24000 }, FALLBACK)).toEqual({
            payload: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
            resolved: { container: "wav", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 },
        });
    });

    it("converts an mp3 bitrate into bits per second, defaulting to 128", () => {
        expect(toOutputFormat({ container: "mp3", sampleRate: 44100 }, FALLBACK)).toEqual({
            payload: { container: "mp3", bit_rate: 128_000, sample_rate: 44100 },
            resolved: { container: "mp3", encoding: "mp3", sampleRate: 44100, channels: 1, bitrate: 128 },
        });
        expect(toOutputFormat({ container: "mp3", bitrate: 64 }, FALLBACK).payload).toMatchObject({
            bit_rate: 64_000,
        });
    });

    describe("rejects what Cartesia cannot produce", () => {
        it("names format.channels for anything but mono", () => {
            expect(catchError(() => toOutputFormat({ channels: 2 }, FALLBACK))).toMatchObject({
                name: "ValidationError",
                provider: "cartesia",
                field: "format.channels",
            });
        });

        it("names format.sampleRate for a rate outside the supported set", () => {
            const thrown = catchError(() => toOutputFormat({ sampleRate: 32000 }, FALLBACK));

            expect(thrown).toMatchObject({ field: "format.sampleRate" });
            expect((thrown as Error).message).toContain("8000, 16000, 22050, 24000, 44100, 48000");
        });

        it("names format.bitrate for an mp3 bitrate that does not exist", () => {
            expect(
                catchError(() => toOutputFormat({ container: "mp3", bitrate: 48 }, FALLBACK)),
            ).toMatchObject({
                field: "format.bitrate",
            });
        });

        it("names format.container for a container with no encoder", () => {
            expect(catchError(() => toOutputFormat({ container: "ogg" }, FALLBACK))).toMatchObject({
                field: "format.container",
            });
        });

        it("names format.encoding for a codec with no equivalent", () => {
            expect(
                catchError(() => toOutputFormat({ container: "raw", encoding: "opus" }, FALLBACK)),
            ).toMatchObject({
                field: "format.encoding",
            });
        });
    });
});

describe("toRawOutputFormat", () => {
    it("passes raw output straight through", () => {
        expect(toRawOutputFormat({ container: "raw", sampleRate: 24000 }, FALLBACK).payload).toEqual({
            container: "raw",
            encoding: "pcm_s16le",
            sample_rate: 24000,
        });
    });

    // The SSE and WebSocket endpoints only accept raw output.
    it("refuses a framed container and points the caller at speak()", () => {
        const thrown = catchError(() => toRawOutputFormat({ container: "wav" }, FALLBACK));

        expect(thrown).toMatchObject({ field: "format.container" });
        expect((thrown as Error).message).toContain("speak()");

        expect(catchError(() => toRawOutputFormat({ container: "mp3" }, FALLBACK))).toMatchObject({
            field: "format.container",
        });
    });
});

describe("toSTTEncoding", () => {
    it("says nothing when the caller named no encoding", () => {
        expect(toSTTEncoding(undefined)).toBeUndefined();
        expect(toSTTEncoding({ sampleRate: 16000 })).toBeUndefined();
    });

    it("maps the input codecs Cartesia accepts", () => {
        expect(toSTTEncoding({ encoding: "pcm_s16le" })).toBe("pcm_s16le");
        expect(toSTTEncoding({ encoding: "pcm_s32le" })).toBe("pcm_s32le");
        expect(toSTTEncoding({ encoding: "mulaw" })).toBe("pcm_mulaw");
        expect(toSTTEncoding({ encoding: "alaw" })).toBe("pcm_alaw");
    });

    it("names format.encoding for a codec with no equivalent", () => {
        expect(catchError(() => toSTTEncoding({ encoding: "mp3" }))).toMatchObject({
            field: "format.encoding",
        });
    });
});

describe("toGenerationConfig", () => {
    it("maps the three controls that have equivalents", () => {
        expect(toGenerationConfig({ speed: 1.2, volume: 1.5, emotion: "curiosity" })).toEqual({
            speed: 1.2,
            volume: 1.5,
            emotion: "curiosity",
        });
    });

    it("sends nothing when there is nothing to say", () => {
        expect(toGenerationConfig(undefined)).toBeUndefined();
        expect(toGenerationConfig({})).toBeUndefined();
        expect(
            toGenerationConfig({ stability: 0.4, similarity: 0.8, instructions: "whisper" }),
        ).toBeUndefined();
    });

    // Out-of-range values are rejected here rather than by a bare 400 later.
    it("holds speed and volume to the ranges Cartesia accepts", () => {
        expect(catchError(() => toGenerationConfig({ speed: 2 }))).toMatchObject({ field: "controls.speed" });
        expect(catchError(() => toGenerationConfig({ speed: 0.5 }))).toMatchObject({
            field: "controls.speed",
        });
        expect(catchError(() => toGenerationConfig({ volume: 3 }))).toMatchObject({
            field: "controls.volume",
        });

        expect(toGenerationConfig({ speed: 0.6, volume: 0.5 })).toEqual({ speed: 0.6, volume: 0.5 });
        expect(toGenerationConfig({ speed: 1.5, volume: 2 })).toEqual({ speed: 1.5, volume: 2 });
    });
});

describe("toVoice", () => {
    it("wraps an id in the specifier Cartesia expects", () => {
        expect(toVoice("voice-1")).toEqual({ mode: "id", id: "voice-1" });
    });

    it("refuses to guess, naming both ways to supply one", () => {
        const thrown = catchError(() => toVoice(undefined));

        expect(thrown).toMatchObject({ name: "ValidationError", field: "voice" });
        expect((thrown as Error).message).toContain("defaultVoice");
    });
});

describe("toRequestOptions", () => {
    it("carries the deadline, the signal and the retry count", () => {
        const signal = AbortSignal.abort();

        expect(toRequestOptions({ signal, timeout: 30_000, retries: 2 })).toEqual({
            signal,
            timeout: 30_000,
            maxRetries: 2,
        });
    });

    // Cartesia's client validates `timeout` on key presence rather than value,
    // so an unset deadline has to be absent, not present-and-undefined -
    // otherwise every request fails with "timeout must be an integer".
    it("omits what the caller did not set, rather than sending undefined", () => {
        expect(toRequestOptions()).toEqual({});
        expect(toRequestOptions({})).toEqual({});
        expect("timeout" in toRequestOptions({ retries: 1 })).toBe(false);
        expect(toRequestOptions({ retries: 1 })).toEqual({ maxRetries: 1 });
    });
});

describe("fromTimestamps", () => {
    // Cartesia returns parallel arrays; core carries spans.
    it("zips the parallel arrays into spans", () => {
        expect(fromTimestamps(["hello", "there"], [0, 0.5], [0.5, 1], "word")).toEqual({
            unit: "word",
            spans: [
                { text: "hello", start: 0, end: 0.5 },
                { text: "there", start: 0.5, end: 1 },
            ],
        });
    });

    it("defaults a time the arrays did not cover", () => {
        expect(fromTimestamps(["h"], [], [], "phoneme").spans).toEqual([{ text: "h", start: 0, end: 0 }]);
    });
});

describe("fromWords", () => {
    it("has nothing to report when there are no words", () => {
        expect(fromWords(undefined)).toBeUndefined();
        expect(fromWords([])).toBeUndefined();
        expect(fromWords("not an array")).toBeUndefined();
    });

    // The SDK types realtime word timings as parallel arrays, but the wire
    // sends objects - so both shapes have to be accepted.
    it("reads the object shape the wire actually sends", () => {
        expect(fromWords([{ word: "hello", start: 0.1, end: 0.4 }])).toEqual([
            { text: "hello", start: 0.1, end: 0.4 },
        ]);
    });

    it("reads the parallel-array shape the SDK types promise", () => {
        expect(fromWords([{ words: ["hello", "there"], start: [0, 0.5], end: [0.5, 1] }])).toEqual([
            { text: "hello", start: 0, end: 0.5 },
            { text: "there", start: 0.5, end: 1 },
        ]);
    });

    it("defaults timings that are missing or unparseable", () => {
        expect(fromWords([{ word: "hello" }])).toEqual([{ text: "hello", start: 0, end: 0 }]);
        expect(fromWords([{ words: ["a"], start: [], end: [] }])).toEqual([{ text: "a", start: 0, end: 0 }]);
    });

    it("skips entries that are neither shape", () => {
        expect(fromWords([null, 42, { unrelated: true }])).toBeUndefined();
        expect(fromWords([null, { word: "kept", start: 1, end: 2 }])).toEqual([
            { text: "kept", start: 1, end: 2 },
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
