import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type {
    AudioStream,
    Capabilities,
    RealtimeSTTInput,
    RealtimeTTSInput,
    RequestContext,
    SpeakInput,
    SpeakResult,
    STTSession,
    TranscribeInput,
    TranscriptResult,
    TTSSession,
    VoiceInfo,
    VoiceProvider,
} from "@voice-sdk/core";
import type { ElevenLabsConfig, ResolvedConfig } from "./config";
import { PROVIDER, resolveConfig } from "./config";
import { ElevenLabsSTT } from "./stt";
import { ElevenLabsSTTSession } from "./stt-session";
import { ElevenLabsTTS } from "./tts";
import { ElevenLabsTTSSession } from "./tts-session";

export class ElevenLabsProvider implements VoiceProvider {
    readonly name = PROVIDER;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    };

    #client: ElevenLabsClient;
    #config: ResolvedConfig;
    #tts: ElevenLabsTTS;
    #stt: ElevenLabsSTT;

    constructor(config: ElevenLabsConfig = {}) {
        this.#config = resolveConfig(config);
        this.#client = new ElevenLabsClient({
            apiKey: this.#config.apiKey,
            baseUrl: this.#config.baseUrl,
        });
        this.#tts = new ElevenLabsTTS(this.#client, this.#config);
        this.#stt = new ElevenLabsSTT(this.#client, this.#config);
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

    async openTTSSession(input?: RealtimeTTSInput): Promise<TTSSession> {
        return ElevenLabsTTSSession.open(this.#config, input);
    }

    async openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        return ElevenLabsSTTSession.open(this.#config, input);
    }

    async listVoices(): Promise<VoiceInfo[]> {
        const response = await this.#client.voices.getAll();

        return response.voices.map((voice) => ({
            id: voice.voiceId,
            name: voice.name,
            labels: voice.labels,
            previewUrl: voice.previewUrl,
        }));
    }
}
