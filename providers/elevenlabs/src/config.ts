import { ConfigError } from "@voice-sdk/core";
import type { AudioFormat } from "@voice-sdk/core";
export interface ElevenLabsConfig {
    apiKey?: string;
    baseUrl?: string;
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    defaultRealtimeSTTModel?: string;
    defaultFormat?: AudioFormat;
}
export interface ResolvedConfig {
    apiKey: string;
    baseUrl?: string;
    defaultVoice: string;
    defaultModel: string;
    defaultSTTModel: string;
    defaultRealtimeSTTModel: string;
    defaultFormat: AudioFormat;
}
export function resolveConfig(config: ElevenLabsConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new ConfigError(
            "elevenlabs",
            "apiKey",
            "Pass `apiKey` or set the ELEVENLABS_API_KEY environment variable.",
        );
    }
    return {
        apiKey,
        baseUrl: config.baseUrl,
        defaultVoice: config.defaultVoice,
        defaultModel: config.defaultModel,
        defaultSTTModel: config.defaultSTTModel,
        defaultRealtimeSTTModel: config.defaultRealtimeSTTModel,
        defaultFormat: config.defaultFormat,
    };
}