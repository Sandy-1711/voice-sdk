import type { StreamSession } from "../session";
import type { AudioChunk, AudioSource } from "../audio";
import type {
    TranscribeInput,
    Transcript,
    TranscriptEvent,
    STTSessionInput,
} from "./types";

/**
 * A streaming-input STT session: push audio frames live (e.g. from a mic),
 * receive transcript events out. Audio in, text out.
 */
export type STTSession = StreamSession<AudioChunk, TranscriptEvent>;

export interface STTEngine {
    /** One-shot: full audio in, full transcript out. */
    transcribe(input: TranscribeInput): Promise<Transcript>;

    /** Output streaming: audio source in, transcript events out as recognized. */
    stream(input: AudioSource): AsyncIterable<TranscriptEvent>;

    /** Input streaming: open a session and push audio frames live. */
    connect(input?: STTSessionInput): STTSession;
}
