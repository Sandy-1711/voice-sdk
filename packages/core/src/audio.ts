export interface OutputFormat {
  container: AudioContainer;
  sampleRate?: number;   // Hz, e.g. 16000, 22050, 44100
  bitrate?: number;      // kbps, for compressed formats (mp3, opus)
  channels?: 1 | 2;      // mono is the voice default
}

/** Common containers, but any provider-specific string is still allowed. */
export type AudioContainer =
  | "mp3"
  | "wav"
  | "pcm"
  | "opus"
  | "flac"
  | "ulaw"
  | (string & {});   

export type AudioChunk = Uint8Array;

export type AudioSource =
  | Uint8Array
  | ArrayBuffer
  | AsyncIterable<AudioChunk>
  | ReadableStream<AudioChunk>;
