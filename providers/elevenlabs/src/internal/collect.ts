import type { AudioSource, AudioChunk } from "@voice-sdk/core";

/** Concatenate audio chunks into a single contiguous buffer. */
export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Collect any `AudioSource` (bytes, ArrayBuffer, async iterable, or web stream)
 * into a single `Uint8Array` — needed for multipart uploads (STT, cloning).
 */
export async function collectAudio(source: AudioSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);

  if (typeof (source as ReadableStream<AudioChunk>).getReader === "function") {
    const reader = (source as ReadableStream<AudioChunk>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concatChunks(chunks);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of source as AsyncIterable<AudioChunk>) {
    chunks.push(chunk);
  }
  return concatChunks(chunks);
}
