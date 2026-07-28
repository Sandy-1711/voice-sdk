import type { TranscribeInput, SynthesizeInput, SynthesizeOutput, Transcription, AudioChunk, Transcript, StreamingTranscriptionInput, StreamingSynthesisInput } from "./types"
export interface Capability {
    tts?: boolean;
    stt?: boolean;

    streamingTTS?: boolean;
    streamingSTT?: boolean;

}

export interface VoiceProvider {
    readonly name: string;
    readonly capabilities: Readonly<Capability>
    /** List voices available to this provider. */
    getVoices(): Promise<string[]>;
    /** Synthesize audio from text. */
    synthesize?: (input: SynthesizeInput) => Promise<SynthesizeOutput>;
    /** Transcribe audio to text. */
    transcribe?: (input: TranscribeInput) => Promise<Transcription>;
    /** Synthesize audio from text as a stream. */
    synthesizeStream?: (input: StreamingSynthesisInput) => AsyncIterable<AudioChunk>;
    /** Transcribe audio to text as a stream. */
    transcribeStream?: (input: StreamingTranscriptionInput) => AsyncIterable<Transcript>;
}
