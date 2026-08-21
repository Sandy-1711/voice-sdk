# @swungstudent/voice

The provider-agnostic half of the voice SDK: one set of types and one entry
point that every provider implements, so switching providers is a constructor
change rather than a rewrite.

This package talks to nothing on its own. Install it alongside a provider —
[`@swungstudent/cartesia`](https://www.npmjs.com/package/@swungstudent/cartesia),
[`@swungstudent/deepgram`](https://www.npmjs.com/package/@swungstudent/deepgram) or
[`@swungstudent/elevenlabs`](https://www.npmjs.com/package/@swungstudent/elevenlabs).

```sh
pnpm add @swungstudent/voice @swungstudent/deepgram
```

## Quickstart

```ts
import { Voice } from "@swungstudent/voice";
import { DeepgramProvider } from "@swungstudent/deepgram";

// The provider reads DEEPGRAM_API_KEY unless you pass `apiKey`.
const voice = new Voice({ provider: new DeepgramProvider() });

const { audio, format } = await voice.speak({ text: "Hello there." });
// audio is a Uint8Array; format tells you how to play it.
```

## The four capabilities

Providers are deliberately narrow. Every one declares which of these it has, and
`Voice` throws a `CapabilityError` naming the provider rather than failing
somewhere deeper.

| Capability    | Method                 | What it means                                    |
| ------------- | ---------------------- | ------------------------------------------------ |
| `tts`         | `speak`, `speakStream` | Full text in, audio out — buffered or streamed   |
| `stt`         | `transcribe`           | A complete recording in, a transcript out        |
| `realtimeTTS` | `openTTSSession`       | Push text as it is generated, audio streams back |
| `realtimeSTT` | `openSTTSession`       | Push audio frames live, transcripts stream back  |

`speakStream` streaming _out_ is not the same as `realtimeTTS`: the duplex
session lets you push text **in** incrementally, a token at a time, which is
what a spoken LLM response needs.

## Batch

```ts
const result = await voice.speak({
  text: "The quick brown fox.",
  voice: "aura-2-thalia-en",
  format: { container: "wav", sampleRate: 24000 },
  controls: { speed: 1.1 },
});

const transcript = await voice.transcribe({
  audio: { url: "https://example.com/clip.wav" }, // or bytes, a Blob, a stream
  timestamps: "segment",
  diarize: true,
});
```

Every `speak` result carries a `ResolvedAudioFormat` — the format actually in
effect, not the one you asked for — so the caller always knows how to play the
bytes.

## Realtime

Sessions are duplex and long-lived. `push` is fire-and-forget so a token loop
never awaits per token; failures surface on `output` and `closed`.

```ts
const session = await voice.openTTSSession({ format: { container: "raw", sampleRate: 24000 } });

for await (const token of llm) session.push(token);
await session.flush();

for await (const event of session.output) {
  if (event.type === "audio") speaker.write(event.data);
  if (event.type === "done") break;
}
await session.close();
```

Going the other way, transcripts arrive with three levels of finality —
`partial` is still being revised, `final` is a stable segment within a turn that
may continue, and `turn_end` means the speaker finished:

```ts
import { turns } from "@swungstudent/voice";

const session = await voice.openSTTSession({ turnDetection: { mode: "vad", silence: 1 } });
microphone.on("data", (frame) => session.push(frame));

for await (const turn of turns(session.output)) {
  console.log(turn.text); // one line per completed turn
}
```

Use `turnDetection: { mode: "manual" }` to decide turn boundaries yourself with
`flush()`.

## Escape hatch

`providerOptions` reaches the underlying API for anything core does not model.
Nested objects merge one level deep, so setting one field does not drop the
siblings the SDK mapped for you:

```ts
await voice.speak({
  text: "Hello.",
  format: { container: "raw", sampleRate: 24000 },
  providerOptions: { mip_opt_out: true },
});
```

## Errors

All of them extend `VoiceError`, so one `catch` covers the SDK.

| Error             | Thrown when                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `CapabilityError` | The provider does not implement what you called                    |
| `ConfigError`     | A provider was built without something it needs, like an API key   |
| `ValidationError` | A request field this provider cannot represent — before it is sent |

`ValidationError` is deliberately thrown _before_ the request goes out, so you
see the offending field instead of a bare 400.

## Helpers

- `collectAudio(source)` — reads any `AudioSource` (bytes, `Blob`, stream,
  async iterable or `{ url }`) into one buffer
- `audioOnly(events)` — drops everything but the bytes from a TTS session
- `turns(events)` — keeps only the events that close a turn
- `TurnTextTracker` — derives whichever of cumulative text / delta a provider
  does not send, so transcripts always carry both

## Licence

MIT
