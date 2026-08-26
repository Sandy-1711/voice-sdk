/**
 * Batch transcription of a complete recording — the wav `speak-to-file.ts`
 * wrote. `audio` also takes a Blob, a stream or `{ url }`.
 *
 *   DEEPGRAM_API_KEY=... pnpm tsx src/transcribe.ts
 */
import { readFile } from "node:fs/promises";
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const IN = "out/hello.wav";

const voice = new Voice({ provider: new DeepgramProvider() });

const result = await voice.transcribe({
    audio: await readFile(IN),
    timestamps: "segment",
    diarize: true,
});

console.log(result.text);
console.log(`${result.duration?.toFixed(2) ?? "?"}s of audio, ${result.words?.length ?? 0} words`);

for (const segment of result.segments ?? []) {
    const span = `${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`;
    console.log(`[${span}] speaker ${segment.speaker ?? "?"}: ${segment.text}`);
}
