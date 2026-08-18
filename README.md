# voice-sdk

One interface for voice providers. Synthesis and transcription, batch and
realtime, with the same types whichever provider is behind them — so switching
is a constructor change rather than a rewrite.

```ts
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const voice = new Voice({ provider: new DeepgramProvider() });

const { audio, format } = await voice.speak({ text: "Hello there." });
const { text } = await voice.transcribe({ audio });
```

Swap `DeepgramProvider` for `CartesiaProvider` or `ElevenLabsProvider` and
nothing else changes.

## Packages

| Package                                            | What it is                                           |
| -------------------------------------------------- | ---------------------------------------------------- |
| [`@swungstudent/voice`](packages/core)             | The contract: `Voice`, the types, the shared helpers |
| [`@swungstudent/cartesia`](providers/cartesia)     | Cartesia — sonic, ink-whisper, ink-2                 |
| [`@swungstudent/deepgram`](providers/deepgram)     | Deepgram — aura-2, nova-3, flux                      |
| [`@swungstudent/elevenlabs`](providers/elevenlabs) | ElevenLabs — eleven_multilingual_v2, scribe          |

Install core plus whichever providers you need. Each provider declares core as a
peer dependency, so an app never ends up with two copies of it.

```sh
pnpm add @swungstudent/voice @swungstudent/deepgram
```

## Capabilities

Four, deliberately narrow. A provider declares which it has, and calling one it
lacks raises a `CapabilityError` naming the provider rather than failing deeper
in.

|                | `tts` | `stt` | `realtimeTTS` | `realtimeSTT` | `listVoices` |
| -------------- | :---: | :---: | :-----------: | :-----------: | :----------: |
| **Cartesia**   |  ✅   |  ✅   |      ✅       |      ✅       |      ✅      |
| **Deepgram**   |  ✅   |  ✅   |      ✅       |      ✅       |      —       |
| **ElevenLabs** |  ✅   |  ✅   |      ✅       |      ✅       |      ✅      |

Deepgram has no voice-listing endpoint because a voice *is* a model there, so
the method is absent rather than faked.

`realtimeTTS` means a duplex session you push text **into** incrementally — what
a spoken LLM response needs. Streaming audio *out* of a one-shot call is
`speakStream`, and every provider with `tts` has it.

See [`@swungstudent/voice`](packages/core) for the full surface, and each
provider's README for what is specific to it.

## Working on it

```sh
pnpm install
pnpm test          # offline: fake servers on ephemeral ports, no keys, no cost
pnpm check-types
pnpm build
```

`pnpm test` is the tier CI runs. It stands real HTTP and WebSocket servers up on
ephemeral ports and drives each provider against them, so URL building, headers,
protocol frames and streaming stay covered without touching a real API.

The second tier does touch the real APIs, and is opt-in because it costs money:

```sh
DEEPGRAM_API_KEY=… CARTESIA_API_KEY=… ELEVENLABS_API_KEY=… pnpm test:live
```

Anything without a key is skipped. Run it before a release — the offline fakes
only encode what we believe each wire format is, and this is what catches one
changing.

### Adding a provider

Every provider package has the same shape, one file per concern:

```
src/
├── config.ts        # api key, defaults, what to use when the caller says nothing
├── format.ts        # core's AudioFormat  ->  this provider's spelling
├── tts.ts           # speak() and speakStream()
├── tts-session.ts   # openTTSSession()
├── stt.ts           # transcribe()
├── stt-session.ts   # openSTTSession()
├── provider.ts      # the class implementing VoiceProvider — mostly delegation
└── index.ts         # the provider class and its config type
```

`provider.ts` ending up as almost pure delegation is the sign the split is
right. [`docs/drafts/building-a-provider.md`](docs/drafts/building-a-provider.md)
walks through how the first one was built, and `@voice-sdk/test-kit` carries the
fake servers and the shared contract assertions every provider is held to.

### Releasing

Changes that users would notice get a changeset:

```sh
pnpm changeset
```

On merge to `main`, CI opens a release pull request that applies the pending
changesets. Merging that publishes to npm. The four packages are versioned
together, so matching versions mean packages built and tested against each other.

## Licence

MIT
