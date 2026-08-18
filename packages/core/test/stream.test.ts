import { describe, expect, it } from "vitest";
import { collect } from "./helpers";
import { audioOnly, turns } from "../src/index";
import type { STTEvent, TTSEvent } from "../src/index";

async function* emit<T>(events: T[]): AsyncIterable<T> {
    for (const event of events) yield event;
}

describe("audioOnly", () => {
    it("keeps the bytes and drops everything else", async () => {
        const first = new Uint8Array([1, 2]);
        const second = new Uint8Array([3]);

        const events: TTSEvent[] = [
            { type: "metadata", requestId: "req-1" },
            { type: "audio", data: first },
            { type: "timing", alignment: { unit: "word", spans: [{ text: "hi", start: 0, end: 1 }] } },
            { type: "audio", data: second },
            { type: "warning", message: "clipped" },
            { type: "done" },
        ];

        await expect(collect(audioOnly(emit(events)))).resolves.toEqual([first, second]);
    });

    it("yields nothing for a stream that carried no audio", async () => {
        await expect(collect(audioOnly(emit<TTSEvent>([{ type: "done" }])))).resolves.toEqual([]);
    });
});

describe("turns", () => {
    it("keeps only the events that close a turn", async () => {
        const events: STTEvent[] = [
            { type: "speech_started", at: 0 },
            { type: "transcript", finality: "partial", text: "hel", delta: "hel", turn: 0 },
            { type: "transcript", finality: "final", text: "hello", delta: "lo", turn: 0 },
            { type: "transcript", finality: "turn_end", text: "hello there", delta: " there", turn: 0 },
            { type: "transcript", finality: "partial", text: "next", delta: "next", turn: 1 },
            { type: "transcript", finality: "turn_end", text: "next turn", delta: " turn", turn: 1 },
        ];

        const kept = await collect(turns(emit(events)));

        expect(kept.map((event) => event.text)).toEqual(["hello there", "next turn"]);
        expect(kept.map((event) => event.turn)).toEqual([0, 1]);
    });

    it("yields nothing while a turn is still open", async () => {
        const events: STTEvent[] = [
            { type: "transcript", finality: "partial", text: "hel", delta: "hel", turn: 0 },
            { type: "speech_ended", at: 1.5 },
        ];

        await expect(collect(turns(emit(events)))).resolves.toEqual([]);
    });
});
