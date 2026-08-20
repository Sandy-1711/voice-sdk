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
} from "@swungstudent/voice";
import type { ElevenLabsConfig, ResolvedConfig } from "./config";
import { DEFAULT_BASE_URL, PROVIDER, resolveConfig } from "./config";
import { camelize, send } from "./internal/http";
import { ElevenLabsSTT } from "./stt";
import { ElevenLabsSTTSession } from "./stt-session";
import { ElevenLabsTTS } from "./tts";
import { ElevenLabsTTSSession } from "./tts-session";

/** Wire shape of `GET /v1/voices`, narrowed to what `VoiceInfo` carries. */
interface WireVoice {
    voiceId: string;
    name?: string;
    labels?: Record<string, string>;
    previewUrl?: string;
}

export class ElevenLabsProvider implements VoiceProvider {
    readonly name = PROVIDER;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    };

    #config: ResolvedConfig;
    #tts: ElevenLabsTTS;
    #stt: ElevenLabsSTT;

    constructor(config: ElevenLabsConfig = {}) {
        this.#config = resolveConfig(config);
        this.#tts = new ElevenLabsTTS(this.#config);
        this.#stt = new ElevenLabsSTT(this.#config);
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
        const response = await send({
            apiKey: this.#config.apiKey,
            url: new URL("/v1/voices", this.#config.baseUrl ?? DEFAULT_BASE_URL),
            method: "GET",
            operation: "listVoices",
            transport: this.#config.transport,
        });

        const payload = camelize(await response.json()) as { voices?: WireVoice[] };

        return (payload.voices ?? []).map((voice) => ({
            id: voice.voiceId,
            name: voice.name,
            labels: voice.labels,
            previewUrl: voice.previewUrl,
        }));
    }
}
