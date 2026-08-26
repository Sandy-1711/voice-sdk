/**
 * Every sample on the landing page is lifted from `examples/`, so the two
 * cannot drift.
 */

const CALLS = `const { audio, format } = await voice.speak({
  text: "Hello there.",
  format: { container: "wav", sampleRate: 24000 },
});

const { text } = await voice.transcribe({ audio });`;

export const PROVIDER_SAMPLES = [
  {
    id: "deepgram",
    name: "Deepgram",
    code: `import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const voice = new Voice({ provider: new DeepgramProvider() });

${CALLS}`,
  },
  {
    id: "cartesia",
    name: "Cartesia",
    code: `import { Voice } from "@swungstudent/voice";
import { CartesiaProvider } from "@swungstudent/cartesia";

const voice = new Voice({ provider: new CartesiaProvider({ defaultVoice }) });

${CALLS}`,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    code: `import { Voice } from "@swungstudent/voice";
import { ElevenLabsProvider } from "@swungstudent/elevenlabs";

const voice = new Voice({ provider: new ElevenLabsProvider({ defaultVoice }) });

${CALLS}`,
  },
];

export const REALTIME_TTS = `const session = await voice.openTTSSession({
  format: { container: "raw", sampleRate: 24000 },
});

// push() is fire-and-forget, so the token loop never waits on the network.
for await (const token of llm) session.push(token);
await session.flush();

for await (const event of session.output) {
  if (event.type === "audio") speaker.write(event.data);
  if (event.type === "done") break;
}`;

export const REALTIME_STT = `import { turns } from "@swungstudent/voice";

const session = await voice.openSTTSession({
  turnDetection: { mode: "vad", silence: 1 },
});

microphone.on("data", (frame) => session.push(frame));

for await (const turn of turns(session.output)) {
  console.log(turn.text); // one line per completed turn
}`;

export const RESOLVED_FORMAT = `const { audio, format } = await voice.speak({
  text: "Hello there.",
  format: { container: "wav" }, // ask for part of a format
});

format;
// { container: "wav", encoding: "pcm_s16le", sampleRate: 24000, channels: 1 }`;

export const VALIDATION = `await voice.speak({
  text: "Hello there.",
  format: { container: "wav", channels: 2 },
});

// ValidationError: Provider "deepgram" rejected "channels": mono only.
// Thrown before the request is sent — not a bare 400 an hour later.`;
