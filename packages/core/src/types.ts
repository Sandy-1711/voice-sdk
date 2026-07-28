export interface SynthesizeInput {
    model_id: string;
    text: string;
    voice?: string;
    outputFormat?: Record<string, any>;
    language?: string;
}


export interface AudioChunk {
    data: Uint8Array;

    sampleRate: number;

    channels: number;

    encoding:
    | "pcm_s16le"
    | "pcm_f32le"
    | "mulaw"
    | "alaw"
    | "opus"
    | "mp3"
    | "wav";

    timestamp?: number;
}

export interface SynthesizeOutput {
    audio: AudioChunk;

}


export type AudioSource = Uint8Array | ArrayBuffer | Blob;


export interface AudioFormat {
    encoding: "pcm_s16le" | "pcm_f32le" | "mulaw" | "alaw";
    sampleRate: number;
    channels?: number;
}

export interface RequestContext {
    signal?: AbortSignal;
    timeout?: number;
    retries?: number;
}

export interface TranscribeInput {
    audio: AudioSource;
    model: string;
    language?: string;
    format?: AudioFormat;
    timestamps?: boolean;
}

export interface TranscriptionWord {
    start: number;
    end: number;
    word: string;
}

export interface Transcription {
    text: string;
    duration?: number;
    language?: string;
    uniqueId?: string;
    words: TranscriptionWord[];
}
export interface Transcript {
    text: string;
    isFinal: boolean;
    language?: string;
}

export interface StreamingSynthesisInput {

    input: AsyncIterable<string>;

    model: string;

    voice?: string;

}
export interface StreamingTranscriptionInput {

    input: AsyncIterable<AudioChunk>;

    model: string;

}