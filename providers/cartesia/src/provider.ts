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
import { buildUrl, send } from "./internal/http";
import { CartesiaSTT } from "./stt";
import { CartesiaSTTSession } from "./stt-session";
import { CartesiaTTS } from "./tts";
import { CartesiaTTSSession } from "./tts-session";

/** Wire shape of one page of `GET /voices`. */
interface VoicePage {
    data?: { id: string; name?: string; language?: string; description?: string }[];
    has_more?: boolean;
}

/** What Cartesia allows per page, so the walk makes as few requests as it can. */
const PAGE_SIZE = 100;

export class CartesiaProvider implements VoiceProvider {
    readonly name = PROVIDER;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    };

    #config: ResolvedConfig;
    #tts: CartesiaTTS;
    #stt: CartesiaSTT;

    constructor(config: CartesiaConfig = {}) {
        this.#config = resolveConfig(config);
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
        return CartesiaTTSSession.open(this.#config, input);
    }

    openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        return CartesiaSTTSession.open(this.#config, input);
    }

    /**
     * The catalogue is cursor-paginated: each page carries `has_more`, and the
     * next one starts after the last id seen. An empty page also ends the walk,
     * so a server that sets `has_more` and then runs dry cannot loop forever.
     */
    async listVoices(): Promise<VoiceInfo[]> {
        const voices: VoiceInfo[] = [];
        let startingAfter: string | undefined;

        for (;;) {
            const response = await send({
                apiKey: this.#config.apiKey,
                url: buildUrl(this.#config.baseUrl, "/voices", {
                    limit: PAGE_SIZE,
                    starting_after: startingAfter,
                }),
                method: "GET",
                operation: "listVoices",
                transport: this.#config.transport,
            });

            const page = (await response.json()) as VoicePage;
            const data = page.data ?? [];

            for (const voice of data) {
                voices.push({
                    id: voice.id,
                    name: voice.name,
                    language: voice.language,
                    labels: voice.description ? { description: voice.description } : undefined,
                });
            }

            if (!page.has_more || data.length === 0) return voices;
            startingAfter = data[data.length - 1]?.id;
        }
    }
}
