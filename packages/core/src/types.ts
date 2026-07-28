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

export interface TranscribeInput {
    audio: AudioChunk;
    model_id: string;
    language?: string;
}

export interface Transcription {
    text: string;
    confidence?: number;
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