/** Every sample here is taken from `examples/`, so the two stay in sync. */

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

// push() does not return a promise, so the loop is not blocked per token.
for await (const token of llm) session.push(token);
await session.flush();

for await (const event of session.output) {
  if (event.type === "audio") speaker.write(event.data);
  if (event.type === "done") break;
}

await session.close();`;

export const REALTIME_STT = `import { turns } from "@swungstudent/voice";

const session = await voice.openSTTSession({
  turnDetection: { mode: "vad", silence: 1 },
});

microphone.on("data", (frame) => session.push(frame));

// turns() filters the event stream down to completed turns.
for await (const turn of turns(session.output)) {
  console.log(turn.text);
}`;

export const RESOLVED_FORMAT = `const { audio, format } = await voice.speak({
  text: "Hello there.",
  format: { container: "wav" },
});

format;
// {
//   container: "wav",
//   encoding: "pcm_s16le",
//   sampleRate: 24000,
//   channels: 1,
// }`;

export const VALIDATION = `await voice.speak({
  text: "Hello there.",
  format: { container: "wav", channels: 2 },
});

// ValidationError: Provider "deepgram" rejected "channels":
// only mono is supported.`;
