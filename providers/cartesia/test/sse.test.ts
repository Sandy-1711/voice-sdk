import { afterEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@swungstudent/voice";
import { collect, fakeHttp, pcmRamp, type FakeHttp } from "@voice-sdk/test-kit";
import { CartesiaProvider } from "../src/index";

const AUDIO = pcmRamp(8);

let server: FakeHttp | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

/** Drives the SSE parser through speakStream, which is its only caller. */
async function streamFrom(...chunks: string[]) {
    server = await fakeHttp({
        "POST /tts/sse": { chunks, headers: { "content-type": "text/event-stream" } },
    });
    const provider = new CartesiaProvider({
        apiKey: "k",
        defaultVoice: "voice-1",
        baseUrl: server.baseUrl,
    });
    return collect(provider.speakStream({ text: "hi" }));
}

function chunk(audio: Uint8Array): string {
    return JSON.stringify({ type: "chunk", data: encodeBase64(audio), done: false });
}

describe("sse framing", () => {
    it("reassembles a frame split across two reads", async () => {
        const frame = `data: ${chunk(AUDIO)}\n\n`;
        const events = await streamFrom(frame.slice(0, 12), frame.slice(12));

        expect(events).toHaveLength(1);
        expect(events[0]?.data).toEqual(AUDIO);
    });

    it("reads several frames arriving in one read", async () => {
        const events = await streamFrom(`data: ${chunk(AUDIO)}\n\ndata: ${chunk(AUDIO)}\n\n`);

        expect(events).toHaveLength(2);
    });

    it("accepts CRLF framing", async () => {
        const events = await streamFrom(`data: ${chunk(AUDIO)}\r\n\r\n`);

        expect(events).toHaveLength(1);
    });

    // A stream that ends without its final blank line still has a frame.
    it("reads a trailing frame with no blank line after it", async () => {
        const events = await streamFrom(`data: ${chunk(AUDIO)}`);

        expect(events).toHaveLength(1);
    });

    it("stops at the done event without waiting for the socket to close", async () => {
        const events = await streamFrom(
            `data: ${chunk(AUDIO)}\n\n`,
            `data: ${JSON.stringify({ type: "done", done: true })}\n\n`,
            `data: ${chunk(AUDIO)}\n\n`,
        );

        expect(events).toHaveLength(1);
    });

    // Cartesia closes with a bare [DONE], which is not JSON.
    it("ignores the sentinel and any frame it cannot parse", async () => {
        const events = await streamFrom(`data: [DONE]\n\n`, `data: not json\n\n`, `:heartbeat\n\n`);

        expect(events).toEqual([]);
    });

    it("fails the stream on an error event", async () => {
        await expect(
            streamFrom(
                `data: ${JSON.stringify({ type: "error", title: "Bad voice", message: "no such voice id" })}\n\n`,
            ),
        ).rejects.toThrow(/Bad voice: no such voice id/);
    });
});
