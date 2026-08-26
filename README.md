# voice-sdk

**Speak. Listen. Switch providers.**

One interface for voice providers. Synthesis and transcription, batch and
realtime, with the same types whichever provider is behind them — so switching
is a constructor change rather than a rewrite.

```sh
pnpm add @swungstudent/voice @swungstudent/deepgram
```

```ts
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const voice = new Voice({ provider: new DeepgramProvider() });

const { audio, format } = await voice.speak({ text: "Hello there." });
const { text } = await voice.transcribe({ audio });
```

Swap `DeepgramProvider` for `CartesiaProvider` or `ElevenLabsProvider` and
nothing below the constructor changes.

[Runnable examples](examples) · [Documentation](apps/web/content/docs) —
the docs site lives in [`apps/web`](apps/web); run it with `pnpm --filter web dev`.

## Four capabilities

A provider declares which it has, and calling one it lacks raises a
`CapabilityError` naming the provider rather than failing deeper in.

|                | `tts` | `stt` | `realtimeTTS` | `realtimeSTT` | `listVoices` |
| -------------- | :---: | :---: | :-----------: | :-----------: | :----------: |
| **Cartesia**   |  ✅   |  ✅   |      ✅       |      ✅       |      ✅      |
| **Deepgram**   |  ✅   |  ✅   |      ✅       |      ✅       |      —       |
| **ElevenLabs** |  ✅   |  ✅   |      ✅       |      ✅       |      ✅      |

`realtimeTTS` means a duplex session you push text **into** incrementally — what
a spoken LLM response needs. Streaming audio _out_ of a one-shot call is
`speakStream`, and every provider with `tts` has it.

## Packages

| Package                                            | What it is                                           |
| -------------------------------------------------- | ---------------------------------------------------- |
| [`@swungstudent/voice`](packages/core)             | The contract: `Voice`, the types, the shared helpers |
| [`@swungstudent/cartesia`](providers/cartesia)     | Cartesia — sonic, ink-whisper, ink-2                 |
| [`@swungstudent/deepgram`](providers/deepgram)     | Deepgram — aura-2, nova-3, flux                      |
| [`@swungstudent/elevenlabs`](providers/elevenlabs) | ElevenLabs — eleven_multilingual_v2, scribe          |

Each provider declares core as a peer dependency, so an app never ends up with
two copies of it. The four are versioned together.

## Working on it

```sh
pnpm install
pnpm test          # offline: fake servers on ephemeral ports, no keys, no cost
pnpm check-types
pnpm build
```

`pnpm test` is the tier CI runs. The second tier touches the real APIs and is
opt-in because it costs money:

```sh
DEEPGRAM_API_KEY=… CARTESIA_API_KEY=… ELEVENLABS_API_KEY=… pnpm test:live
```

Contributing, adding a provider, the test kit and the release process are all
documented on the site, under
[`apps/web/content/docs/contributing`](apps/web/content/docs/contributing).

## Licence

MIT
