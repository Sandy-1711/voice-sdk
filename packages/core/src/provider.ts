import type { TTSEngine } from "./tts";
import type { STTEngine } from "./stt";
import type { VoiceCloning } from "./cloning";

/** The capability slots a provider may expose. */
export type CapKey = "tts" | "stt" | "cloning";

/**
 * A provider adapter. Concrete providers declare the engines they support as
 * **required** fields (e.g. `tts: TTSEngine`) so their presence is known at the
 * type level; unsupported capabilities are simply omitted.
 */
export interface VoiceProvider {
    /** Stable provider identifier, e.g. "elevenlabs". */
    readonly name: string;
    /** Text-to-speech engine, if supported. */
    tts?: TTSEngine;
    /** Speech-to-text engine, if supported. */
    stt?: STTEngine;
    /** Voice-cloning engine, if supported. */
    cloning?: VoiceCloning;
    /** Optional startup hook (open connections, warm up, auth). */
    init?(): Promise<void>;
    /** Optional teardown hook (close connections, free resources). */
    close?(): Promise<void>;
}
