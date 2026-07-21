import type { AudioSource } from "./audio";

/** A voice available to a provider — either a stock voice or a cloned one. */
export interface ClonedVoice {
    /** Provider-assigned voice id (use as `SpeakInput.voice`). */
    id: string;
    /** Human-readable name. */
    name: string;
    /** `true` if this voice was created via cloning (vs a stock voice). */
    cloned?: boolean;
}

/** Input for creating a cloned voice from audio samples. */
export interface CloneVoiceInput {
    /** Name for the new voice. */
    name: string;
    /** One or more audio samples of the target voice. */
    samples: AudioSource[];
    /** Optional description stored with the voice. */
    description?: string;
    /** Optional provider-specific labels/metadata. */
    labels?: Record<string, string>;
    /** Escape hatch for provider-specific params not covered above. */
    providerOptions?: Record<string, unknown>;
}

export interface VoiceCloning {
    /** Create a new voice from audio samples. */
    clone(input: CloneVoiceInput): Promise<ClonedVoice>;

    /** List voices available to this provider (stock + cloned). */
    list(): Promise<ClonedVoice[]>;

    /** Delete a cloned voice by id. */
    delete(voiceId: string): Promise<void>;
}
