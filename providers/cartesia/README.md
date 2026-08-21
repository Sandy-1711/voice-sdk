# @swungstudent/cartesia

Cartesia provider for [`@swungstudent/voice`](https://www.npmjs.com/package/@swungstudent/voice).
All four capabilities: synthesis and transcription, batch and realtime.

```sh
pnpm add @swungstudent/voice @swungstudent/cartesia
```

```ts
import { Voice } from "@swungstudent/voice";
import { CartesiaProvider } from "@swungstudent/cartesia";

const voice = new Voice({
  provider: new CartesiaProvider({ defaultVoice: "a0e99841-438c-4a64-b679-ae501e7d6091" }),
});

const { audio } = await voice.speak({ text: "Hello there." });
```

## Configuration

```ts
new CartesiaProvider({
  apiKey: "...",              // falls back to CARTESIA_API_KEY
  baseUrl: "https://...",
  defaultVoice: "a0e99841-...",
  defaultModel: "sonic-3.5",
  defaultSTTModel: "ink-whisper",
  defaultFormat: { container: "wav", sampleRate: 44100 },
});
```

Models are pinned rather than tracking `-latest`, so generated audio does not
shift under you between releases.

## What is worth knowing

**A voice id is required for synthesis.** Set `defaultVoice` or pass `voice` per
call; otherwise you get a `ValidationError` naming both ways to supply one.
`listVoices()` walks the paginated catalogue for you.

**Realtime STT has two endpoints, and `turnDetection` picks between them.**

| `turnDetection`             | Endpoint               | Default model | Behaviour                                        |
| --------------------------- | ---------------------- | ------------- | ------------------------------------------------ |
| `{ mode: "vad" }` (default) | `/stt/turns/websocket` | `ink-2`       | Detects turns itself and emits turn events       |
| `{ mode: "manual" }`        | `/stt/websocket`       | `ink-whisper` | No turn detection at all — `flush()` transcribes |

Both are normalised to the same event stream. Asking for automatic turns from
`ink-whisper` raises a `ValidationError` at open time rather than leaving you
waiting for turns that will never arrive.

**Streaming synthesis is headerless.** The SSE and WebSocket endpoints only
accept the `raw` container; ask for `wav` or `mp3` there and you get a
`ValidationError` pointing you at `speak()`.

**Codecs carry a `pcm_` prefix on the wire** (`mulaw` becomes `pcm_mulaw`), which
this package handles — you keep using core's names.

**Prosody has real limits.** `speed` accepts 0.6–1.5 and `volume` 0.5–2, checked
before the request goes out so you get the field name rather than a bare 400.
`stability`, `similarity` and `instructions` have no Cartesia equivalent and are
ignored.

## Formats

| Container | Encoding                                  | Sample rates                            |
| --------- | ----------------------------------------- | --------------------------------------- |
| `raw`     | `pcm_s16le`, `pcm_f32le`, `mulaw`, `alaw` | 8000, 16000, 22050, 24000, 44100, 48000 |
| `wav`     | as above                                  | as above                                |
| `mp3`     | —                                         | as above, bitrate 32/64/96/128/192 kbps |

Mono only. Anything else raises a `ValidationError` naming the field, before a
request is sent.

## Licence

MIT
