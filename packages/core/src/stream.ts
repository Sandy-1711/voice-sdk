import type { STTEvent, STTTranscriptEvent, TTSEvent } from "./realtime";

/** Drops everything but the bytes, for callers that just want to play audio. */
export async function* audioOnly(events: AsyncIterable<TTSEvent>): AsyncIterable<Uint8Array> {
    for await (const event of events) {
        if (event.type === "audio") yield event.data;
    }
}

/** Keeps only the events that close a turn. */
export async function* turns(events: AsyncIterable<STTEvent>): AsyncIterable<STTTranscriptEvent> {
    for await (const event of events) {
        if (event.type === "transcript" && event.finality === "turn_end") yield event;
    }
}
