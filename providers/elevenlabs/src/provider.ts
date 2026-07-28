import { VoiceProvider } from "@voice-sdk/core";
import type { Capabilities } from "@voice-sdk/core";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { PROVIDER, resolveConfig, type ElevenLabsConfig } from "./config";
import { ElevenLabsSTT } from "./stt";
import { ElevenLabsTTS } from "./tts";
import type { TranscribeInput, TranscriptResult, RequestContext } from "@voice-sdk/core";
import type { AudioStream, SpeakInput, SpeakResult } from "@voice-sdk/core";

export class ElevenLabsProvider implements VoiceProvider {
    readonly name = PROVIDER;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    }
    #client: ElevenLabsClient;
    #stt: ElevenLabsSTT;
    #tts: ElevenLabsTTS;
    constructor(config: ElevenLabsConfig = {}) {
        const resolvedConfig = resolveConfig(config);
        this.#client = new ElevenLabsClient({
            apiKey: resolvedConfig.apiKey
        });
        this.#stt = new ElevenLabsSTT(this.#client, resolvedConfig);
        this.#tts = new ElevenLabsTTS(this.#client, resolvedConfig);
    }

    speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
        return this.#tts.speak(input, context);
    }

    speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
        return this.#tts.speakStream(input, context);
    }

    transcribe(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult> {
        return this.#stt.transcribe(input, context);
    }

}