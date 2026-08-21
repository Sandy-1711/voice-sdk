import { Cartesia } from "@cartesia/cartesia-js";
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
import type { CartesiaConfig, ResolvedConfig } from "./config";
import { PROVIDER, resolveConfig } from "./config";
import { ensureWebSocket } from "./internal/websocket";
import { CartesiaSTT } from "./stt";
import { CartesiaSTTSession } from "./stt-session";
import { CartesiaTTS } from "./tts";
import { CartesiaTTSSession } from "./tts-session";

export class CartesiaProvider implements VoiceProvider {
    readonly name: string;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    };

    #client: Cartesia;
    #config: ResolvedConfig;
    #tts: CartesiaTTS;
    #stt: CartesiaSTT;

    constructor(config: CartesiaConfig = {}) {
        ensureWebSocket();
        this.name = PROVIDER;
        this.#config = resolveConfig(config);
        this.#client = new Cartesia({
            apiKey: this.#config.apiKey,
            baseURL: this.#config.baseUrl,
        });
        this.#tts = new CartesiaTTS(this.#config);
        this.#stt = new CartesiaSTT(this.#config);
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

    openTTSSession(input?: RealtimeTTSInput): Promise<TTSSession> {
        return CartesiaTTSSession.open(this.#client, this.#config, input);
    }

    openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        return CartesiaSTTSession.open(this.#config, input);
    }

    async listVoices(): Promise<VoiceInfo[]> {
        const voices: VoiceInfo[] = [];
        for await (const voice of this.#client.voices.list()) {
            voices.push({
                id: voice.id,
                name: voice.name,
                language: voice.language,
                labels: voice.description ? { description: voice.description } : undefined,
            });
        }
        return voices;
    }
}
