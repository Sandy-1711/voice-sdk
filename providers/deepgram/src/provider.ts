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
    VoiceProvider,
} from "@voice-sdk/core";
import type { DeepgramConfig, ResolvedConfig } from "./config";
import { PROVIDER, resolveConfig } from "./config";
import { DeepgramSTT } from "./stt";
import { DeepgramSTTSession } from "./stt-session";
import { DeepgramTTS } from "./tts";
import { DeepgramTTSSession } from "./tts-session";

export class DeepgramProvider implements VoiceProvider {
    readonly name = PROVIDER;
    readonly capabilities: Readonly<Capabilities> = {
        tts: true,
        stt: true,
        realtimeTTS: true,
        realtimeSTT: true,
    };

    #config: ResolvedConfig;
    #tts: DeepgramTTS;
    #stt: DeepgramSTT;

    constructor(config: DeepgramConfig = {}) {
        this.#config = resolveConfig(config);
        this.#tts = new DeepgramTTS(this.#config);
        this.#stt = new DeepgramSTT(this.#config);
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
        return DeepgramTTSSession.open(this.#config, input);
    }

    openSTTSession(input?: RealtimeSTTInput): Promise<STTSession> {
        return DeepgramSTTSession.open(this.#config, input);
    }

    // `listVoices` is deliberately absent: Deepgram has no voice-listing
    // endpoint, because a voice is a model. `Voice` throws CapabilityError.
}
