import { describe, expect, it } from "vitest";
import {
    DEFAULT_FORMAT,
    assertCharacterTimings,
    fromAlignment,
    fromWord,
    fromWsAlignment,
    toFileFormat,
    toGranularity,
    toOutputFormat,
    toRealtimeAudioFormat,
    toSource,
    toStreamOutputFormat,
    toVoiceSettings,
} from "../src/format";

describe("toOutputFormat", () => {
    // ElevenLabs fuses container, sample rate and bitrate into one token.
    it("builds the fused token from the server default", () => {
        expect(toOutputFormat(undefined, DEFAULT_FORMAT)).toEqual({
            value: "mp3_44100_128",
            resolved: { container: "mp3", encoding: "mp3", sampleRate: 44100, bitrate: 128, channels: 1 },
        });
    });

    it("takes the bitrate the caller asked for", () => {
        expect(toOutputFormat({ container: "mp3", bitrate: 64 }, DEFAULT_FORMAT).value).toBe("mp3_44100_64");
    });

    it("reports wav as signed 16-bit pcm, which is all ElevenLabs produces", () => {
        expect(toOutputFormat({ container: "wav", sampleRate: 16000 }, DEFAULT_FORMAT)).toEqual({
            value: "wav_16000",
            resolved: { container: "wav", encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
        });
    });

    it("maps ogg and webm onto opus, and says so in the resolved format", () => {
        expect(toOutputFormat({ container: "ogg", sampleRate: 48000, bitrate: 64 }, DEFAULT_FORMAT)).toEqual({
            value: "opus_48000_64",
            resolved: { container: "ogg", encoding: "opus", sampleRate: 48000, bitrate: 64, channels: 1 },
        });
        expect(toOutputFormat({ container: "webm", sampleRate: 48000 }, DEFAULT_FORMAT).resolved.container).toBe("ogg");
    });

    it("names headerless output by its codec, spelling mu-law ulaw", () => {
        expect(toOutputFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 16000 }, DEFAULT_FORMAT).value).toBe("pcm_16000");
        expect(toOutputFormat({ container: "raw", encoding: "mulaw", sampleRate: 8000 }, DEFAULT_FORMAT).value).toBe("ulaw_8000");
        expect(toOutputFormat({ container: "raw", encoding: "alaw", sampleRate: 8000 }, DEFAULT_FORMAT).value).toBe("alaw_8000");
    });

    describe("rejects what the API will not accept", () => {
        it("names format.channels for anything but mono", () => {
            expect(catchError(() => toOutputFormat({ channels: 2 }, DEFAULT_FORMAT))).toMatchObject({
                name: "ValidationError",
                provider: "elevenlabs",
                field: "format.channels",
            });
        });

        // Built, then checked against the values the API actually takes - and
        // the message lists the neighbours in the same family.
        it("names the whole format for a combination that does not exist", () => {
            const thrown = catchError(() => toOutputFormat({ container: "mp3", sampleRate: 48000 }, DEFAULT_FORMAT));

            expect(thrown).toMatchObject({ field: "format" });
            expect((thrown as Error).message).toContain("mp3_44100_128");
            expect((thrown as Error).message).toContain(`"mp3_48000_128" is not supported`);
        });

        it("names format.container for a container with no encoder", () => {
            expect(catchError(() => toOutputFormat({ container: "flac" }, DEFAULT_FORMAT))).toMatchObject({
                field: "format.container",
            });
        });

        it("names format.encoding for a codec that cannot be headerless", () => {
            expect(catchError(() => toOutputFormat({ container: "raw", encoding: "pcm_f32le" }, DEFAULT_FORMAT))).toMatchObject({
                field: "format.encoding",
            });
        });
    });
});

describe("toStreamOutputFormat", () => {
    it("passes through anything the streaming endpoints accept", () => {
        expect(toStreamOutputFormat(undefined, DEFAULT_FORMAT).value).toBe("mp3_44100_128");
        expect(toStreamOutputFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 24000 }, DEFAULT_FORMAT).value).toBe("pcm_24000");
    });

    // A wav header declares a length that is not known until generation ends.
    it("refuses wav and points the caller at speak()", () => {
        const thrown = catchError(() => toStreamOutputFormat({ container: "wav", sampleRate: 16000 }, DEFAULT_FORMAT));

        expect(thrown).toMatchObject({ field: "format.container" });
        expect((thrown as Error).message).toContain("speak()");
    });
});

describe("toVoiceSettings", () => {
    it("maps the four controls that have equivalents", () => {
        expect(toVoiceSettings({ speed: 1.1, stability: 0.4, similarity: 0.8, style: 0.2 })).toEqual({
            speed: 1.1,
            stability: 0.4,
            similarityBoost: 0.8,
            style: 0.2,
        });
    });

    it("sends nothing when there is nothing to say", () => {
        expect(toVoiceSettings(undefined)).toBeUndefined();
        expect(toVoiceSettings({})).toBeUndefined();
        expect(toVoiceSettings({ volume: 2, emotion: "happy", instructions: "whisper" })).toBeUndefined();
    });

    it("keeps a zero, which is a real setting rather than an absent one", () => {
        expect(toVoiceSettings({ stability: 0 })).toEqual({ stability: 0 });
    });
});

describe("toSource", () => {
    // ElevenLabs takes a URL natively, so skip the round trip when given one.
    it("forwards a url rather than downloading it", async () => {
        await expect(toSource({ url: "https://audio.test/clip.wav" })).resolves.toEqual({
            sourceUrl: "https://audio.test/clip.wav",
        });
    });

    it("collects any other source into a file", async () => {
        const audio = new Uint8Array([1, 2, 3]);

        await expect(toSource(audio)).resolves.toEqual({ file: audio });
    });
});

describe("toFileFormat", () => {
    it("says nothing when the caller gave no format", () => {
        expect(toFileFormat(undefined)).toBeUndefined();
    });

    it("calls anything with a header other, for ElevenLabs to sniff", () => {
        expect(toFileFormat({ container: "wav" })).toBe("other");
        expect(toFileFormat({ container: "mp3", encoding: "mp3" })).toBe("other");
        expect(toFileFormat({ encoding: "mp3" })).toBe("other");
    });

    // The raw path is lower latency, but it exists for exactly one shape.
    it("takes the low-latency path for 16 kHz mono pcm", () => {
        expect(toFileFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 16000 })).toBe("pcm_s16le_16");
        expect(toFileFormat({ container: "raw", encoding: "pcm_s16le" })).toBe("pcm_s16le_16");
        expect(toFileFormat({ encoding: "pcm_s16le", sampleRate: 16000 })).toBe("pcm_s16le_16");
    });

    it("refuses any other headerless shape rather than letting it be sniffed and fail", () => {
        expect(catchError(() => toFileFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 8000 }))).toMatchObject({
            field: "format",
        });
        expect(catchError(() => toFileFormat({ container: "raw", encoding: "mulaw", sampleRate: 8000 }))).toMatchObject({
            field: "format",
        });
        expect(catchError(() => toFileFormat({ container: "raw", encoding: "pcm_s16le", sampleRate: 16000, channels: 2 }))).toMatchObject({
            field: "format",
        });
    });
});

describe("toGranularity", () => {
    it("asks for none when the caller wants no timestamps", () => {
        expect(toGranularity(undefined)).toBe("none");
        expect(toGranularity(false)).toBe("none");
    });

    it("passes word and character through", () => {
        expect(toGranularity("word")).toBe("word");
        expect(toGranularity("character")).toBe("character");
    });

    it("refuses a granularity ElevenLabs does not report", () => {
        expect(catchError(() => toGranularity("segment"))).toMatchObject({ name: "ValidationError", field: "timestamps" });
    });
});

describe("assertCharacterTimings", () => {
    it("allows the two spellings of character alignment", () => {
        expect(() => assertCharacterTimings(true)).not.toThrow();
        expect(() => assertCharacterTimings("character")).not.toThrow();
    });

    it("refuses word and phoneme, which ElevenLabs cannot meet", () => {
        expect(catchError(() => assertCharacterTimings("word"))).toMatchObject({ field: "timings" });
        expect(catchError(() => assertCharacterTimings("phoneme"))).toMatchObject({ field: "timings" });
    });
});

describe("fromWord", () => {
    // logprob is a log probability in [-inf, 0], not a 0-1 confidence.
    it("turns a log probability into a confidence", () => {
        const word = fromWord({ text: "hello", start: 0.1, end: 0.5, type: "word", logprob: 0, speakerId: "speaker_0" });

        expect(word.confidence).toBe(1);
        expect(word).toMatchObject({ text: "hello", start: 0.1, end: 0.5, kind: "word", speaker: "speaker_0" });
    });

    it("keeps a low confidence low", () => {
        expect(fromWord({ text: "?", type: "word", logprob: -2.3 }).confidence).toBeCloseTo(0.1, 2);
    });

    it("defaults the timings ElevenLabs left off", () => {
        expect(fromWord({ text: " ", type: "spacing", logprob: 0 })).toMatchObject({ start: 0, end: 0 });
    });
});

describe("fromAlignment", () => {
    it("has nothing to report without an alignment", () => {
        expect(fromAlignment(undefined)).toBeUndefined();
    });

    it("zips the parallel arrays into character spans", () => {
        expect(
            fromAlignment({
                characters: ["h", "i"],
                characterStartTimesSeconds: [0, 0.1],
                characterEndTimesSeconds: [0.1, 0.2],
            }),
        ).toEqual({
            unit: "character",
            spans: [
                { text: "h", start: 0, end: 0.1 },
                { text: "i", start: 0.1, end: 0.2 },
            ],
        });
    });

    it("defaults a time the arrays did not cover", () => {
        expect(
            fromAlignment({ characters: ["h"], characterStartTimesSeconds: [], characterEndTimesSeconds: [] })?.spans,
        ).toEqual([{ text: "h", start: 0, end: 0 }]);
    });
});

describe("fromWsAlignment", () => {
    // The socket reports milliseconds as start + duration, unlike REST which
    // already reports seconds as start + end.
    it("converts start and duration in milliseconds into seconds and an end", () => {
        expect(
            fromWsAlignment({ chars: ["h", "i"], charStartTimesMs: [0, 100], charDurationsMs: [100, 150] }),
        ).toEqual({
            unit: "character",
            spans: [
                { text: "h", start: 0, end: 0.1 },
                { text: "i", start: 0.1, end: 0.25 },
            ],
        });
    });

    it("has nothing to report without an alignment", () => {
        expect(fromWsAlignment(undefined)).toBeUndefined();
    });
});

describe("toRealtimeAudioFormat", () => {
    it("defaults to the one format every provider accepts", () => {
        expect(toRealtimeAudioFormat(undefined)).toBe("pcm_16000");
    });

    it("names the sample rate for pcm", () => {
        expect(toRealtimeAudioFormat({ encoding: "pcm_s16le", sampleRate: 8000 })).toBe("pcm_8000");
    });

    it("pins mu-law to the only rate it runs at", () => {
        expect(toRealtimeAudioFormat({ encoding: "mulaw", sampleRate: 16000 })).toBe("ulaw_8000");
    });

    it("refuses a codec the realtime endpoint does not take", () => {
        expect(catchError(() => toRealtimeAudioFormat({ encoding: "alaw" }))).toMatchObject({
            field: "inputFormat.encoding",
        });
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
