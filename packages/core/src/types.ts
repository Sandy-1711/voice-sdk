import type { AudioChunk, AudioFormat, AudioSource } from "./audio";

export interface SynthesizeInput {
    model_id: string;
    text: string;
    voice?: string;
    outputFormat?: Record<string, any>;
    language?: string;
}

export interface SynthesizeOutput {
    audio: AudioChunk;
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
