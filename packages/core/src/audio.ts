export type AudioEncoding =
    | "pcm_s16le"
    | "pcm_s32le"
    | "pcm_f32le"
    | "mulaw"
    | "alaw"
    | "mp3"
    | "opus"
    | "aac"
    | "flac";

export type AudioContainer =
    | "raw"
    | "wav"
    | "mp3"
    | "ogg"
    | "webm"
    | "flac"
    | "aac";

/** A requested format. Unset fields fall back to the provider's default. */
export interface AudioFormat {
    container?: AudioContainer;
    encoding?: AudioEncoding;
    sampleRate?: number;
    channels?: number;
    /** kbps. Only meaningful for mp3, opus and aac. */
    bitrate?: number;
}

/** The format actually in effect, so callers know how to play the bytes. */
export interface ResolvedAudioFormat extends AudioFormat {
    container: AudioContainer;
    encoding: AudioEncoding;
    sampleRate: number;
    channels: number;
}

export type AudioSource =
    | Uint8Array
    | ArrayBuffer
    | Blob
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>
    | { url: string };

export interface AudioChunk {
    data: Uint8Array;
    /** Seconds from the start of the stream. */
    offset?: number;
}

/** An audio stream that knows its format before the first chunk arrives. */
export interface AudioStream extends AsyncIterable<AudioChunk> {
    readonly format: ResolvedAudioFormat;
}

/** A span of text with its position in the audio, in seconds. */
export interface TimingSpan {
    text: string;
    start: number;
    end: number;
}

export interface Alignment {
    unit: "word" | "character" | "phoneme";
    spans: TimingSpan[];
}

/** Reads any `AudioSource` into a single buffer. */
export async function collectAudio(source: AudioSource): Promise<Uint8Array> {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());

    if ("url" in source) {
        const response = await fetch(source.url);
        return new Uint8Array(await response.arrayBuffer());
    }

    const chunks: Uint8Array[] = [];
    if (source instanceof ReadableStream) {
        const reader = source.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }
    } else {
        for await (const chunk of source) chunks.push(chunk);
    }
    return concatAudio(chunks);
}

/** Providers that carry audio as base64 JSON decode it before core sees it. */
export function decodeBase64(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
    // Chunked because spreading a whole audio buffer into fromCharCode
    // overflows the call stack.
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export function concatAudio(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}
