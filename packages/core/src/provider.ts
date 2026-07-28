import type { AudioStream } from "./audio";
import type { RealtimeSTTInput, RealtimeTTSInput, STTSession, TTSSession } from "./realtime";
import type { RequestContext, SpeakInput, SpeakResult, TranscribeInput, TranscriptResult } from "./types";

export interface Capabilities {
    /** One-shot synthesis and output streaming. */
    tts: boolean;
    /** Batch transcription of complete audio. */
    stt: boolean;
    /** Duplex session: incremental text in, audio out. */
    realtimeTTS: boolean;
    /** Duplex session: audio frames in, incremental transcripts out. */
    realtimeSTT: boolean;
}

export type CapabilityName = keyof Capabilities;

export interface VoiceInfo {
    id: string;
    name?: string;
    language?: string;
    labels?: Record<string, string>;
    previewUrl?: string;
}

/**
 * If a capability flag is true, its method(s) must be present.
 */
export interface VoiceProvider {
    readonly name: string;
    readonly capabilities: Readonly<Capabilities>;

    /** `tts` */
    speak?(input: SpeakInput, context?: RequestContext): Promise<SpeakResult>;
    speakStream?(input: SpeakInput, context?: RequestContext): AudioStream;

    /** `stt` */
    transcribe?(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult>;

    /** `realtimeTTS` */
    openTTSSession?(input?: RealtimeTTSInput): Promise<TTSSession>;

    /** `realtimeSTT` */
    openSTTSession?(input?: RealtimeSTTInput): Promise<STTSession>;

    listVoices?(): Promise<VoiceInfo[]>;
    close?(): Promise<void>;
}
