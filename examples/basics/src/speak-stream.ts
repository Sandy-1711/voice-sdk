/**
 * Streaming synthesis: bytes written as they arrive rather than after the whole
 * clip is ready. The stream knows its format before the first chunk, so a
 * speaker or a socket can be set up ahead of time.
 *
 *   DEEPGRAM_API_KEY=... pnpm tsx src/speak-stream.ts
 *
 * Headerless PCM, so play it with a format flag:
 *
 *   ffplay -f s16le -ar 24000 -ch_layout mono out/stream.raw
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const OUT = "out/stream.raw";
const TEXT = "Streaming means the first bytes arrive long before the last word is synthesized.";

const voice = new Voice({ provider: new DeepgramProvider() });

const stream = voice.speakStream({
    text: TEXT,
    format: { container: "raw", encoding: "pcm_s16le", sampleRate: 24000 },
});

console.log(`${stream.format.encoding} ${stream.format.sampleRate}Hz ${stream.format.channels}ch`);

await mkdir("out", { recursive: true });
const file = createWriteStream(OUT);

const started = Date.now();
let chunks = 0;
let bytes = 0;

for await (const chunk of stream) {
    if (chunks === 0) console.log(`first chunk after ${Date.now() - started}ms`);
    file.write(chunk.data);
    chunks += 1;
    bytes += chunk.data.byteLength;
}

file.end();
await finished(file);

console.log(`wrote ${OUT}, ${bytes} bytes in ${chunks} chunks`);
