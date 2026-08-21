# @swungstudent/deepgram

Deepgram provider for [`@swungstudent/voice`](https://www.npmjs.com/package/@swungstudent/voice).
All four capabilities: synthesis and transcription, batch and realtime.

```sh
pnpm add @swungstudent/voice @swungstudent/deepgram
```

```ts
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

const voice = new Voice({
  provider: new DeepgramProvider(), // reads DEEPGRAM_API_KEY
});

const { audio } = await voice.speak({ text: "Hello there." });
```

## Configuration

```ts
new DeepgramProvider({
  apiKey: "...",                  // falls back to DEEPGRAM_API_KEY
  baseUrl: "https://...",         // self-hosted or a regional host
  defaultVoice: "aura-2-thalia-en",
  defaultModel: "aura-2-thalia-en",
  defaultSTTModel: "nova-3",
  defaultRealtimeSTTModel: "nova-3",
  defaultFormat: { container: "wav", sampleRate: 24000 },
});
```

Models are pinned rather than tracking `-latest`, so generated audio does not
shift under you between releases.

## What is worth knowing

**A voice _is_ a model.** Deepgram has no separate voice or language parameter —
both are folded into the model name, as in `aura-2-thalia-en`. `voice` and
`model` are two spellings of the same thing, and `model` wins if you pass both.

**`listVoices` is deliberately absent**, for the same reason: there is no
voice-listing endpoint. Calling it through `Voice` raises a `CapabilityError`
rather than returning something invented.

**No timings.** Deepgram synthesis reports no alignment at any granularity, so
asking for `timings` raises a `ValidationError` instead of quietly returning
audio with nothing attached. Use Cartesia or ElevenLabs if you need them.

**Realtime STT has two endpoints, and the model picks between them.**
`nova-3` and friends use `/v1/listen`, with two levels of finality and a
mandatory heartbeat this package sends for you. A `flux-*` model uses
`/v2/listen`, which has its own turn lifecycle. Both are normalised to the same
event stream, so consumers cannot tell which one they are talking to — with one
exception: Flux decides turns for itself and has no manual finalize, so
`turnDetection: { mode: "manual" }` raises a `ValidationError` at open time
rather than leaving you waiting for turns that never come.

**Streaming synthesis is headerless.** `openTTSSession` only emits raw PCM,
mu-law or A-law. Ask for a framed container there and you get a
`ValidationError` pointing you at `speak()`.

## Formats

| Container     | Encoding                     | Sample rates                     |
| ------------- | ---------------------------- | -------------------------------- |
| `raw`         | `pcm_s16le`, `mulaw`, `alaw` | 8000, 16000, 24000, 32000, 48000 |
| `wav`         | `pcm_s16le`, `mulaw`, `alaw` | as above                         |
| `mp3`         | —                            | as above, with `bitrate`         |
| `ogg`         | opus                         | as above, with `bitrate`         |
| `flac`, `aac` | —                            | as above                         |

Mono only. Anything else raises a `ValidationError` naming the field, before a
request is sent.

## Licence

MIT
