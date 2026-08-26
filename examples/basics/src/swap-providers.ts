/**
 * The whole point of the core contract: the constructor names a provider and
 * nothing below it changes.
 *
 *   PROVIDER=deepgram   DEEPGRAM_API_KEY=...                           pnpm tsx src/swap-providers.ts
 *   PROVIDER=cartesia   CARTESIA_API_KEY=...   CARTESIA_VOICE_ID=...   pnpm tsx src/swap-providers.ts
 *   PROVIDER=elevenlabs ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... pnpm tsx src/swap-providers.ts
 */
import { CapabilityError, Voice, type VoiceProvider } from "@swungstudent/voice";
import { CartesiaProvider } from "@swungstudent/cartesia";
import { DeepgramProvider } from "@swungstudent/deepgram";
import { ElevenLabsProvider } from "@swungstudent/elevenlabs";

const TEXT = "Hello there. I would like to book a table for two people tomorrow evening.";

// Cartesia and ElevenLabs address a voice by id; for Deepgram a voice is a model.
const providers = {
    cartesia: () => new CartesiaProvider({ defaultVoice: process.env.CARTESIA_VOICE_ID }),
    deepgram: () => new DeepgramProvider(),
    elevenlabs: () => new ElevenLabsProvider({ defaultVoice: process.env.ELEVENLABS_VOICE_ID }),
};

type ProviderName = keyof typeof providers;

await roundTrip(new Voice({ provider: providers[selected()]() }));

/** Everything in here is provider-agnostic. */
async function roundTrip(voice: Voice<VoiceProvider>): Promise<void> {
    const { audio, format } = await voice.speak({ text: TEXT });
    console.log(`${voice.provider.name}: ${audio.byteLength} bytes of ${format.container}`);

    const { text } = await voice.transcribe({ audio, format });
    console.log(`heard back: ${text}`);

    try {
        const voices = await voice.listVoices();
        console.log(`${voices.length} voices available`);
    } catch (error) {
        // A missing capability is refused by name rather than failing deeper in.
        if (!(error instanceof CapabilityError)) throw error;
        console.log(error.message);
    }
}

function selected(): ProviderName {
    const name = process.env.PROVIDER ?? "deepgram";
    if (!(name in providers)) {
        throw new Error(`PROVIDER must be one of: ${Object.keys(providers).join(", ")}`);
    }
    return name as ProviderName;
}
