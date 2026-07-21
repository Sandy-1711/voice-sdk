import type { StreamSession } from "../session";
import type { AudioChunk } from "../audio";
import type { SpeakInput, AudioResult, TTSSessionInput } from "./types";

/**
 * A streaming-input TTS session: push text tokens as they arrive (e.g. from an
 * LLM), receive audio chunks out. Text in, audio out.
 */
export type TTSSession = StreamSession<string, AudioChunk>;

export interface TTSEngine {
    /** One-shot: full text in, full audio out. */
    speak(input: SpeakInput): Promise<AudioResult>;

    /** Output streaming: full text in, audio chunks out as they are generated. */
    stream(input: SpeakInput): AsyncIterable<AudioChunk>;

    /** Input streaming: open a session and push text tokens as they arrive. */
    connect(input?: TTSSessionInput): TTSSession;
}
