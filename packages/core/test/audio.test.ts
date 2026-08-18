import { afterEach, describe, expect, it } from "vitest";
import { pcmRamp, serveBytes, type ByteServer } from "./helpers";
import { collectAudio, concatAudio, decodeBase64, encodeBase64 } from "../src/index";

const BYTES = new Uint8Array([0, 1, 2, 253, 254, 255]);

let server: ByteServer | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

describe("collectAudio", () => {
    it("hands a Uint8Array straight back, without copying", async () => {
        await expect(collectAudio(BYTES)).resolves.toBe(BYTES);
    });

    it("reads an ArrayBuffer", async () => {
        const buffer = BYTES.slice().buffer;
        await expect(collectAudio(buffer)).resolves.toEqual(BYTES);
    });

    it("reads a Blob", async () => {
        await expect(collectAudio(new Blob([BYTES]))).resolves.toEqual(BYTES);
    });

    it("reads a ReadableStream", async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(BYTES.subarray(0, 3));
                controller.enqueue(BYTES.subarray(3));
                controller.close();
            },
        });

        await expect(collectAudio(stream)).resolves.toEqual(BYTES);
    });

    it("reads an async iterable", async () => {
        async function* chunks() {
            yield BYTES.subarray(0, 1);
            yield BYTES.subarray(1);
        }

        await expect(collectAudio(chunks())).resolves.toEqual(BYTES);
    });

    it("fetches a url source", async () => {
        const audio = pcmRamp(64);
        server = await serveBytes(audio);

        await expect(collectAudio({ url: server.url })).resolves.toEqual(audio);
    });

    it("survives an empty stream", async () => {
        async function* nothing(): AsyncIterable<Uint8Array> {
            /* no chunks */
        }

        await expect(collectAudio(nothing())).resolves.toEqual(new Uint8Array(0));
    });
});

describe("base64", () => {
    it("round-trips arbitrary bytes", () => {
        expect(decodeBase64(encodeBase64(BYTES))).toEqual(BYTES);
    });

    it("round-trips a buffer larger than the 0x8000 chunk step", () => {
        // Spreading a whole buffer into fromCharCode overflows the stack, so
        // the encoder walks it in chunks; this is the case that proves it.
        const large = pcmRamp(40_000);

        expect(large.byteLength).toBeGreaterThan(0x8000);
        expect(decodeBase64(encodeBase64(large))).toEqual(large);
    });

    it("matches Node's own base64 encoding", () => {
        expect(encodeBase64(BYTES)).toBe(Buffer.from(BYTES).toString("base64"));
        expect(decodeBase64(Buffer.from(BYTES).toString("base64"))).toEqual(BYTES);
    });

    it("handles empty input at both ends", () => {
        expect(encodeBase64(new Uint8Array(0))).toBe("");
        expect(decodeBase64("")).toEqual(new Uint8Array(0));
    });
});

describe("concatAudio", () => {
    it("joins chunks in order", () => {
        expect(concatAudio([BYTES.subarray(0, 2), BYTES.subarray(2)])).toEqual(BYTES);
    });

    it("returns an empty buffer for no chunks", () => {
        expect(concatAudio([])).toEqual(new Uint8Array(0));
    });

    it("ignores empty chunks between real ones", () => {
        expect(concatAudio([BYTES.subarray(0, 3), new Uint8Array(0), BYTES.subarray(3)])).toEqual(BYTES);
    });
});
