import { VoiceProvider } from "@voice-sdk/core";
import type { Capabilities } from "@voice-sdk/core";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { resolveConfig, type ElevenLabsConfig } from "./config";

export class ElevenLabsProvider implements VoiceProvider {
    readonly name = "elevenlabs";
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    }
    #client: ElevenLabsClient;

    constructor(config: ElevenLabsConfig = {}) {
        const resolvedConfig = resolveConfig(config);
        this.#client = new ElevenLabsClient({
            apiKey: resolvedConfig.apiKey
        });
    }
}