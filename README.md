# voice-sdk

One TypeScript interface for text-to-speech and speech-to-text. Write your
application against `Voice`, and choose a provider when you construct it.

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

To use a different provider, change the constructor. Method names, input types,
return types, and errors are the same for all of them.

**[Documentation](https://voice-ai-sdk.vercel.app/docs)** ·
[Quickstart](https://voice-ai-sdk.vercel.app/docs/quickstart) ·
[Providers](https://voice-ai-sdk.vercel.app/docs/providers) ·
[Examples](examples)

## Capabilities

| Capability    | Methods                | Description                                              |
| ------------- | ---------------------- | -------------------------------------------------------- |
| `tts`         | `speak`, `speakStream` | Convert text to audio, buffered or streamed              |
| `stt`         | `transcribe`           | Convert a complete recording to a transcript             |
| `realtimeTTS` | `openTTSSession`       | Stream text into a session and receive audio back        |
| `realtimeSTT` | `openSTTSession`       | Stream audio into a session and receive transcripts back |

Each provider declares which capabilities it supports. Calling a method a
provider does not implement throws a `CapabilityError`.

|                | `tts` | `stt` | `realtimeTTS` | `realtimeSTT` | `listVoices` | Timings   |
| -------------- | :---: | :---: | :-----------: | :-----------: | :----------: | --------- |
| **Cartesia**   |  Yes  |  Yes  |      Yes      |      Yes      |     Yes      | Word      |
| **Deepgram**   |  Yes  |  Yes  |      Yes      |      Yes      |      No      | None      |
| **ElevenLabs** |  Yes  |  Yes  |      Yes      |      Yes      |     Yes      | Character |

## Packages

| Package                                            | Description                                 |
| -------------------------------------------------- | ------------------------------------------- |
| [`@swungstudent/voice`](packages/core)             | Core: the `Voice` class, types, and helpers |
| [`@swungstudent/cartesia`](providers/cartesia)     | Cartesia provider                           |
| [`@swungstudent/deepgram`](providers/deepgram)     | Deepgram provider                           |
| [`@swungstudent/elevenlabs`](providers/elevenlabs) | ElevenLabs provider                         |

Provider packages declare the core package as a peer dependency, so an
application resolves a single copy of the types. All four are released together
and share a version number.

Node.js 18 or later. This is a server-side library; browser and edge runtimes
are not supported.

## Development

```sh
pnpm install
pnpm test        # offline tests against local fake servers
pnpm check-types
pnpm lint
pnpm build
```

`pnpm test` is the tier CI runs. It starts HTTP and WebSocket servers on
ephemeral ports and runs each provider against them, so no API keys are needed.

Live tests call the real APIs and are opt-in. Put the keys in a git-ignored
`.env` at the repository root, or pass them inline:

```sh
pnpm test:live
```

Providers without a key are skipped, so a run with no keys passes having proven
nothing — set `VOICE_LIVE_REQUIRE_KEYS=1` to make that a failure instead.

The documentation site is in [`apps/web`](apps/web). Run it with
`pnpm --filter web dev`. See
[Contributing](https://voice-ai-sdk.vercel.app/docs/contributing) for the
repository layout, how to add a provider, and the release process.

## Licence

MIT
