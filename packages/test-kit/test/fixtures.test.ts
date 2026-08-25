import { describe, expect, it } from "vitest";
import { bytes, collect, pcmRamp, pcmSilence, wav, waitFor } from "../src/index";

describe("audio fixtures", () => {
    it("makes silence two bytes per sample", () => {
        const silence = pcmSilence(4);

        expect(silence).toHaveLength(8);
        expect([...silence].every((byte) => byte === 0)).toBe(true);
    });

    // The ramp is what makes a truncated buffer obvious in a diff, so the values
    // have to actually differ per sample.
    it("makes a ramp of distinct little-endian samples", () => {
        const ramp = pcmRamp(3);
        const view = new DataView(ramp.buffer);

        expect(ramp).toHaveLength(6);
        expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([
            0, 257, 514,
        ]);
    });

    it("keeps ramp samples inside the s16 range", () => {
        const ramp = pcmRamp(400);
        const view = new DataView(ramp.buffer);

        for (let i = 0; i < 400; i += 1) {
            expect(view.getInt16(i * 2, true)).toBeGreaterThanOrEqual(0);
        }
    });

    it("builds a bytes array from its arguments", () => {
        expect(bytes(1, 2, 255)).toEqual(new Uint8Array([1, 2, 255]));
    });
});

describe("wav", () => {
    const pcm = pcmRamp(8);
    const header = (audio: Uint8Array) => new DataView(audio.buffer);
    const ascii = (audio: Uint8Array, at: number, length: number) =>
        new TextDecoder().decode(audio.slice(at, at + length));

    it("prefixes a 44-byte RIFF header", () => {
        const audio = wav(pcm);

        expect(audio).toHaveLength(44 + pcm.length);
        expect(ascii(audio, 0, 4)).toBe("RIFF");
        expect(ascii(audio, 8, 8)).toBe("WAVEfmt ");
        expect(ascii(audio, 36, 4)).toBe("data");
    });

    it("writes the sizes the container claims", () => {
        const audio = wav(pcm);
        const view = header(audio);

        expect(view.getUint32(4, true)).toBe(36 + pcm.length);
        expect(view.getUint32(40, true)).toBe(pcm.length);
    });

    it("defaults to 16k mono and derives the byte rate from it", () => {
        const view = header(wav(pcm));

        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(16000);
        expect(view.getUint32(28, true)).toBe(16000 * 2);
        expect(view.getUint16(34, true)).toBe(16);
    });

    it("takes a rate and channel count", () => {
        const view = header(wav(pcm, 44100, 2));

        expect(view.getUint16(22, true)).toBe(2);
        expect(view.getUint32(24, true)).toBe(44100);
        expect(view.getUint32(28, true)).toBe(44100 * 2 * 2);
        expect(view.getUint16(32, true)).toBe(4);
    });

    it("copies the samples in after the header", () => {
        expect(wav(pcm).slice(44)).toEqual(pcm);
    });
});

describe("collect", () => {
    async function* upTo(n: number) {
        for (let i = 0; i < n; i += 1) yield i;
    }

    it("drains an async iterable in order", async () => {
        await expect(collect(upTo(3))).resolves.toEqual([0, 1, 2]);
    });

    it("returns nothing for an empty stream", async () => {
        await expect(collect(upTo(0))).resolves.toEqual([]);
    });

    it("passes a failure through rather than swallowing it", async () => {
        async function* fails() {
            yield 1;
            throw new Error("socket died");
        }

        await expect(collect(fails())).rejects.toThrow("socket died");
    });

    // Without this every provider test that waits on a stream would hang for the
    // whole vitest timeout instead of failing with what it managed to read.
    it("gives up on a stuck stream, saying how far it got", async () => {
        async function* stalls() {
            yield 1;
            yield 2;
            await new Promise(() => {});
        }

        await expect(collect(stalls(), 50)).rejects.toThrow("collect() timed out after 2 items.");
    });
});

describe("waitFor", () => {
    it("returns as soon as the condition holds", async () => {
        let ready = false;
        setTimeout(() => (ready = true), 20);

        await expect(waitFor(() => ready)).resolves.toBeUndefined();
    });

    it("returns immediately for a condition already true", async () => {
        await expect(waitFor(() => true)).resolves.toBeUndefined();
    });

    it("times out naming what it was waiting for", async () => {
        await expect(waitFor(() => false, 50, "the socket to open")).rejects.toThrow(
            "Timed out waiting for the socket to open.",
        );
    });

    it("falls back to a generic label", async () => {
        await expect(waitFor(() => false, 50)).rejects.toThrow("Timed out waiting for condition.");
    });
});
