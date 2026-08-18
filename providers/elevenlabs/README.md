# @voice-sdk/elevenlabs

ElevenLabs provider for [`@voice-sdk/core`](https://www.npmjs.com/package/@voice-sdk/core).
All four capabilities: synthesis and transcription, batch and realtime.

```sh
pnpm add @voice-sdk/core @voice-sdk/elevenlabs
```

```ts
import { Voice } from "@voice-sdk/core";
import { ElevenLabsProvider } from "@voice-sdk/elevenlabs";

const voice = new Voice({
  provider: new ElevenLabsProvider({ defaultVoice: "21m00Tcm4TlvDq8ikWAM" }),
});

const { audio } = await voice.speak({ text: "Hello there." });
```

## Configuration

```ts
new ElevenLabsProvider({
  apiKey: "...",                          // falls back to ELEVENLABS_API_KEY
  baseUrl: "https://api.eu.residency.elevenlabs.io", // residency host
  defaultVoice: "21m00Tcm4TlvDq8ikWAM",
  defaultModel: "eleven_multilingual_v2",
  defaultSTTModel: "scribe_v2",
  defaultRealtimeSTTModel: "scribe_v2_realtime",
  defaultFormat: { container: "mp3", sampleRate: 44100, bitrate: 128 },
});
```

Models are pinned rather than tracking `-latest`, so generated audio does not
shift under you between releases.

## What is worth knowing

**A voice id is required for synthesis.** ElevenLabs puts it in the URL path, so
there is nothing sensible to default to. Set `defaultVoice` or pass `voice` per
call; otherwise you get a `ValidationError` naming both ways to supply one.
`listVoices()` returns what your account can reach.

**Timings are character-level only.** Asking for `word` or `phoneme` raises a
`ValidationError`. `timings: true` and `timings: "character"` both work, and
switch `speak` to the endpoint that returns alignment alongside the audio.

**Formats are one fused token.** ElevenLabs spells container, sample rate and
bitrate as `mp3_44100_128`, `pcm_16000`, `ulaw_8000`. This package builds that
token from a normal `AudioFormat` and checks it against the values the API
actually accepts, so an unsupported combination fails with the supported
neighbours listed rather than a bare 400.

**`wav` cannot be streamed** — its header declares a length that is not known
until generation ends. `speakStream` and `openTTSSession` raise a
`ValidationError` pointing you at `speak()`.

**Realtime STT audio must be PCM or mu-law.** 16-bit PCM at any rate, or mu-law
at 8 kHz.

**Batch STT has one low-latency headerless path**, for 16 kHz mono 16-bit PCM.
Any other headerless shape is rejected rather than being sniffed and failing;
use a container format for everything else.

## Realtime synthesis behaviour

The TTS socket opens lazily on the first `push`, which is what makes `cancel()`
work: ElevenLabs has no cancel command, so dropping the connection is the only
way to stop audio it has already queued — and the next `push` transparently
opens a new one.

Pushes get a trailing space if they do not have one. ElevenLabs triggers
generation on whitespace, so without it the last word is held indefinitely.

## Licence

MIT
