import { TTSEngine } from "./tts";
import { STTEngine } from "./stt";
import { VoiceCloning } from "./cloning";

export type CapKey = "tts" | "stt" | "cloning";

export interface VoiceProvider {
    readonly name: string;
    tts?: TTSEngine;
    stt?: STTEngine;
    cloning?: VoiceCloning;
    init?(): Promise<void>;
    close?(): Promise<void>;
}
