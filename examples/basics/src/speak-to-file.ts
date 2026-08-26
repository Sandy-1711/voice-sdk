/**
 * One-shot synthesis: text in, a playable wav on disk.
 *
 * `transcribe.ts` reads the file this one writes, so run it first.
 *
 *   DEEPGRAM_API_KEY=... pnpm tsx src/speak-to-file.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const OUT = "out/hello.wav";
const TEXT = "Hello there. I would like to book a table for two people tomorrow evening.";

// The provider reads DEEPGRAM_API_KEY unless you pass `apiKey`.
const voice = new Voice({ provider: new DeepgramProvider() });

const { audio, format, requestId } = await voice.speak({
    text: TEXT,
    format: { container: "wav", sampleRate: 24000 },
});

await mkdir("out", { recursive: true });
await writeFile(OUT, audio);

console.log(`wrote ${OUT}, ${audio.byteLength} bytes`);

// `format` is what is actually in the file, not what was asked for.
console.log(`${format.container} ${format.encoding} ${format.sampleRate}Hz ${format.channels}ch`);
console.log(`request ${requestId ?? "(none reported)"}`);
