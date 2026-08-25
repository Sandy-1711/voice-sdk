/**
 * A consumer, compiled against the built `.d.ts` files out of the packed
 * tarballs rather than against `src`. Nothing here runs; the compile is the
 * test.
 *
 * The `@ts-expect-error` lines are load-bearing in the other direction: if
 * resolution silently produced `any`, they would stop erroring and tsc would
 * report the unused directive, so a broken path cannot pass as a clean one.
 */
import { CartesiaProvider } from "@swungstudent/cartesia";
import { DeepgramProvider } from "@swungstudent/deepgram";
import { ElevenLabsProvider } from "@swungstudent/elevenlabs";
import { Voice } from "@swungstudent/voice";
import type { STTEvent, TTSEvent, VoiceProvider } from "@swungstudent/voice";

// The generic has to carry the concrete provider through. Without it this is
// VoiceProvider and every provider-specific member is gone.
const voice = new Voice({ provider: new DeepgramProvider({ apiKey: "k" }) });
const kept: DeepgramProvider = voice.provider;
void kept;

export async function batch(): Promise<number> {
    const spoken = await voice.speak({ text: "hello", format: { container: "wav" } });
    const heard = await voice.transcribe({ audio: spoken.audio });
    return spoken.audio.byteLength + heard.text.length;
}

// Exhaustive: a member added to the union without a case here fails to compile.
export function onTTS(event: TTSEvent): number {
    switch (event.type) {
        case "audio":
            return event.data.byteLength;
        case "timing":
            return event.alignment.spans.length;
        case "flushed":
        case "cleared":
            return typeof event.id === "number" ? event.id : 0;
        case "done":
            return -1;
        case "metadata":
            return event.requestId ? 1 : 0;
        case "warning":
            return event.message.length;
    }
}

export function onSTT(event: STTEvent): string {
    switch (event.type) {
        case "transcript":
            return `${event.finality}:${event.turn}:${event.delta}`;
        case "speech_started":
        case "speech_ended":
            return String(event.at ?? "");
        case "metadata":
            return event.model ?? "";
        case "warning":
            return event.message;
    }
}

// Swapping providers without touching the call sites is the whole point of the
// core contract, so it has to typecheck across all three.
export async function anyProvider(provider: VoiceProvider): Promise<void> {
    const swapped = new Voice({ provider });
    await swapped.speak({ text: "hi" });
}

export const providers = [
    new CartesiaProvider({ apiKey: "k", defaultVoice: "v" }),
    new ElevenLabsProvider({ apiKey: "k", defaultVoice: "v" }),
    new DeepgramProvider({ apiKey: "k" }),
];

export async function sessions(): Promise<void> {
    const call = new AbortController();
    const speaking = await voice.openTTSSession({ signal: call.signal });
    speaking.push("hello");
    await speaking.flush();
    call.abort();
}

/* The compile has to reject all of these. */

export async function rejected(): Promise<void> {
    // @ts-expect-error - speak() requires text
    await voice.speak({});

    // @ts-expect-error - `speed` is not a SpeakInput field; controls carries it
    await voice.speak({ text: "hi", speed: 2 });

    // @ts-expect-error - "chunk" is a wire type, not a member of TTSEvent
    const event: TTSEvent = { type: "chunk" };
    void event;

    // @ts-expect-error - close() was removed; sessions own their lifecycle
    await voice.close();
}

export function unnarrowed(event: TTSEvent): unknown {
    // @ts-expect-error - `data` exists only on the audio member
    return event.data;
}
