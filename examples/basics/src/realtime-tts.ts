/**
 * A realtime synthesis session driven by pushed text — the shape a spoken LLM
 * response has. Tokens arrive one at a time and audio comes back before the
 * sentence is finished.
 *
 *   DEEPGRAM_API_KEY=... pnpm tsx src/realtime-tts.ts
 *
 *   ffplay -f s16le -ar 24000 -ch_layout mono out/session.raw
 */
import { mkdir, writeFile } from "node:fs/promises";
import { Voice, concatAudio } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const OUT = "out/session.raw";
const REPLY = "Of course. A table for two tomorrow evening at seven. Shall I book it?";

const voice = new Voice({ provider: new DeepgramProvider() });

const session = await voice.openTTSSession({
    format: { container: "raw", encoding: "pcm_s16le", sampleRate: 24000 },
});

const chunks: Uint8Array[] = [];
const playing = (async () => {
    for await (const event of session.output) {
        if (event.type === "audio") chunks.push(event.data);
        if (event.type === "done") break;
    }
})();

// push() is fire-and-forget, so the token loop never waits on the network.
for await (const token of tokens()) session.push(token);
await session.flush();

await playing;
await session.close();

await mkdir("out", { recursive: true });
await writeFile(OUT, concatAudio(chunks));

console.log(`wrote ${OUT}, ${chunks.length} chunks`);

/** Stands in for a streaming LLM. */
async function* tokens(): AsyncGenerator<string> {
    for (const word of REPLY.split(" ")) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        yield `${word} `;
    }
}
