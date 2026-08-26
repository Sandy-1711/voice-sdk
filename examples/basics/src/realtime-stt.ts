/**
 * A realtime transcription session fed at real-time pacing — the shape a
 * microphone or a phone call has.
 *
 * There is no microphone here, so the audio is synthesized first and pushed
 * back in frame by frame. Swap the loop at the bottom for your capture device
 * and nothing above it changes.
 *
 *   DEEPGRAM_API_KEY=... pnpm tsx src/realtime-stt.ts
 */
import { DEFAULT_REALTIME_INPUT_FORMAT, Voice, turns } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const TEXT = "Hello there. I would like to book a table for two people tomorrow evening.";
const FRAME_MS = 20;
/** How long to keep listening after the audio runs out, for the turn to close. */
const TRAILING_SILENCE_MS = 3000;

const voice = new Voice({ provider: new DeepgramProvider() });

const { audio, format } = await voice.speak({ text: TEXT, format: DEFAULT_REALTIME_INPUT_FORMAT });

const session = await voice.openSTTSession({
    inputFormat: format,
    turnDetection: { mode: "vad", silence: 1 },
    interimResults: true,
});

const listening = (async () => {
    for await (const turn of turns(session.output)) {
        console.log(`turn ${turn.turn}: ${turn.text}`);
    }
})();

// pcm_s16le is two bytes a sample, so a frame is a fixed slice of the buffer.
const frame = (format.sampleRate * format.channels * 2 * FRAME_MS) / 1000;

for (let offset = 0; offset < audio.byteLength; offset += frame) {
    session.push(audio.subarray(offset, offset + frame));
    await sleep(FRAME_MS);
}

await sleep(TRAILING_SILENCE_MS);
await session.close();
await listening;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
