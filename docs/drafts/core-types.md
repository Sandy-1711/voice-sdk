# Core types

Everything in `@swungstudent/voice`, what it means, and why it is shaped that way.

Each section is written twice. **In plain words** is the idea with no jargon.
**In practice** is the type and the evidence behind it. Read one, both, or skip
to the tables.

Source: [`packages/core/src/`](../packages/core/src/). Design rationale and the
provider-by-provider field mapping that produced these types:
[type-design.md](./type-design.md) and [provider-research.md](./provider-research.md).

---

## What this SDK does

**In plain words:** Computers can turn writing into a talking voice, and turn a
talking voice back into writing. Different companies sell that service, and each
one asks for things in its own way. This SDK is a translator: you say what you
want once, and it talks to whichever company you picked.

**In practice:** a provider-agnostic contract over speech APIs. Four operations:

| Operation        | You give it              | You get back              | Shape          |
| ---------------- | ------------------------ | ------------------------- | -------------- |
| **TTS**          | all your text            | all the audio             | one request    |
| **STT**          | all your audio           | all the text              | one request    |
| **realtime TTS** | text, a piece at a time  | audio, as it is generated | a live session |
| **realtime STT** | audio, a piece at a time | text, as it is recognized | a live session |

The distinction that trips people up: **streaming output is not realtime.**
Every TTS provider can hand back audio in chunks from a single request — that is
`speakStream`, and it lives under the `tts` capability. Only some providers let
you _keep feeding text in_ while audio comes out — that is `openTTSSession`, and
it lives under `realtimeTTS`. OpenAI can do the first but not the second.

---

## Layer 1 — audio

[`packages/core/src/audio.ts`](../packages/core/src/audio.ts)

### AudioEncoding and AudioContainer

**In plain words:** Sound has to be written down as numbers. There are different
ways to write those numbers down, the same way a picture can be a JPG or a PNG.
If you read the numbers the wrong way, you get noise instead of a voice.

**In practice:**

```ts
type AudioEncoding =
    | "pcm_s16le" | "pcm_s32le" | "pcm_f32le"   // raw samples
    | "mulaw" | "alaw"                          // telephony
    | "mp3" | "opus" | "aac" | "flac";          // compressed

type AudioContainer = "raw" | "wav" | "mp3" | "ogg" | "webm" | "flac" | "aac";
```

Two separate axes on purpose. `encoding` is how one sample is written;
`container` is the wrapper around the stream. `wav` + `pcm_s16le` is a real
combination, and so is `raw` + `pcm_s16le` — the same samples, one with a
header and one without.

Endianness and bit width are in the name because they are not interchangeable.
Handing 32-bit floats to something expecting 16-bit integers produces static,
not a quieter voice.

### AudioFormat and ResolvedAudioFormat

**In plain words:** `AudioFormat` is what you _asked for_ — and you're allowed
to leave blanks. `ResolvedAudioFormat` is what you _actually got_, with every
blank filled in.

**In practice:**

```ts
interface AudioFormat {
    container?: AudioContainer;
    encoding?: AudioEncoding;
    sampleRate?: number;
    channels?: number;
    bitrate?: number;      // kbps, mp3/opus/aac only
}

interface ResolvedAudioFormat extends AudioFormat {
    container: AudioContainer;
    encoding: AudioEncoding;
    sampleRate: number;
    channels: number;
}
```

Every field on the request is optional because providers disagree on what is
even selectable — OpenAI will not let you choose a sample rate, Deepgram will
not let you choose a container.

The split into two types exists because **no provider tells you the format in
its response.** It is implied by your request plus their defaults. If the caller
cannot read back "24 kHz, signed 16-bit, mono", they cannot play the bytes. So
every result carries a `ResolvedAudioFormat`, and filling it in is the
provider's job.

### AudioSource

**In plain words:** the different ways you might hand over a sound file.

```ts
type AudioSource =
    | Uint8Array | ArrayBuffer | Blob
    | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>
    | { url: string };
```

`{ url }` is in there because AssemblyAI accepts _only_ a URL and ElevenLabs
accepts `source_url`. Providers that need bytes fetch it; providers that need a
URL upload first. The caller never has to know which kind they are talking to.

`collectAudio(source)` flattens any of these into one `Uint8Array`, and
`concatAudio(chunks)` joins buffers. Both live in core because every batch
provider needs them.

### AudioChunk and AudioStream

```ts
interface AudioChunk {
    data: Uint8Array;
    offset?: number;       // seconds from stream start
}

interface AudioStream extends AsyncIterable<AudioChunk> {
    readonly format: ResolvedAudioFormat;
}
```

`AudioChunk` deliberately does **not** carry the format. Format is a property of
the _stream_, not of each 20 ms frame — repeating it thousands of times is both
wasteful and a chance for it to disagree with itself. It lives on `AudioStream`
instead, where it is known before the first chunk arrives, so a caller can set
up playback in advance.

---

## Layer 2 — words and timing

### TimingSpan and Alignment

**In plain words:** which word was said at which second.

```ts
interface TimingSpan { text: string; start: number; end: number }

interface Alignment {
    unit: "word" | "character" | "phoneme";
    spans: TimingSpan[];
}
```

This normalizes two genuinely different wire shapes:

```
Cartesia    { words: ["Hello","there"], start: [0, 0.42], end: [0.4, 0.88] }
ElevenLabs  { chars: ["H","e"], charStartTimesMs: [0,50], charDurationsMs: [50,40] }

both become  spans: [{ text, start, end }, ...]  in seconds
```

Parallel arrays and milliseconds both die at the provider boundary. **Every time
value in this SDK is seconds.** That single rule is why nobody has to remember
that AssemblyAI reports milliseconds.

### TranscriptWord and TranscriptSegment

[`packages/core/src/types.ts`](../packages/core/src/types.ts)

```ts
interface TranscriptWord {
    text: string;
    start: number;         // seconds
    end: number;
    confidence?: number;   // 0-1
    speaker?: string;
    punctuated?: string;   // Deepgram's punctuated_word, when it differs
    kind?: "word" | "spacing" | "audio_event";
}
```

`kind` exists because ElevenLabs emits spacing and tagged audio events
(laughter, applause) in the same array as real words. `punctuated` exists
because Deepgram sends both the raw and the punctuated form.

One trap worth knowing: **ElevenLabs' `logprob` is not a probability.** A
provider must convert it (`Math.exp`) or leave `confidence` undefined. Passing
it through raw would quietly mean "confidence: -0.3".

---

## Layer 3 — the four operations

### TTS: SpeakInput and SpeakResult

**In plain words:** give it words, get back a voice saying them.

```ts
interface SpeakInput {
    text: string;
    model?: string;
    voice?: string;
    language?: string;
    format?: AudioFormat;
    controls?: VoiceControls;
    timings?: boolean | "word" | "character" | "phoneme";
    providerOptions?: Record<string, unknown>;
}

interface SpeakResult {
    audio: Uint8Array;
    format: ResolvedAudioFormat;
    alignment?: Alignment;
    requestId?: string;
    raw?: unknown;
}
```

`model` and `voice` are optional because every provider has a configured
default. `voice` is a flat string even though ElevenLabs puts it in the URL path
and Deepgram folds it into the model name — where it goes is the provider's
problem, not the caller's.

### VoiceControls

**In plain words:** knobs for _how_ the voice sounds — faster, louder, happier.

```ts
interface VoiceControls {
    speed?: number;        // 1 = normal
    volume?: number;       // 1 = normal
    stability?: number;    // 0-1
    similarity?: number;   // 0-1
    style?: number;        // 0-1
    emotion?: string;
    instructions?: string; // free-text style direction
}
```

No two providers overlap on more than `speed`. This is one loose bag of optional
fields rather than four provider-specific types, and the rule that makes it
tolerable is in [The four rules](#the-four-rules) below: **an unsupported knob
is ignored, never fatal.** `instructions` is OpenAI-only; `emotion` and `volume`
are Cartesia-only; `stability`/`similarity`/`style` are ElevenLabs-only.

### STT: TranscribeInput and TranscriptResult

**In plain words:** give it a recording, get back what was said.

```ts
interface TranscribeInput {
    audio: AudioSource;
    model?: string;
    language?: string;
    format?: AudioFormat;   // required only for headerless PCM
    timestamps?: false | "word" | "segment" | "character";
    diarize?: boolean;      // who said what
    speakerCount?: number;
    keyterms?: string[];    // bias recognition toward these
    prompt?: string;
    providerOptions?: Record<string, unknown>;
}

interface TranscriptResult {
    text: string;
    language?: string;
    languageConfidence?: number;
    duration?: number;      // seconds
    confidence?: number;
    words?: TranscriptWord[];
    segments?: TranscriptSegment[];
    requestId?: string;
    raw?: unknown;
}
```

`words` is optional, not an empty array, because it is only populated when
timestamps were actually requested. An empty array would claim "no words were
spoken"; `undefined` correctly says "nobody asked".

### Realtime: the session

**In plain words:** a phone line that stays open. You keep talking into it and it
keeps answering, instead of sending one letter and waiting for one reply.

[`packages/core/src/realtime.ts`](../packages/core/src/realtime.ts)

```ts
interface RealtimeSession<TIn, TEvent> {
    readonly output: AsyncIterable<TEvent>;
    push(input: TIn): void;
    flush(): Promise<void>;
    cancel(): void;
    close(): Promise<void>;
    readonly closed: Promise<void>;
}

interface TTSSession extends RealtimeSession<string, TTSEvent> {
    readonly format: ResolvedAudioFormat;
}
type STTSession = RealtimeSession<Uint8Array, STTEvent>;
```

One generic covers both directions. The verbs are what make this a session
rather than a stream:

| Verb     | On a TTS session                    | On an STT session                 |
| -------- | ----------------------------------- | --------------------------------- |
| `push`   | send text to be spoken              | send audio to be transcribed      |
| `flush`  | synthesize what is buffered **now** | finalize what is buffered **now** |
| `cancel` | barge-in: drop queued audio         | drop the in-progress turn         |
| `close`  | end the session cleanly             | end the session cleanly           |

`push` returns `void`, not a promise, so an LLM token loop never has to await
per token. Failures surface on `output` and `closed` instead.

`cancel` is documented as **best-effort**. Deepgram's `Clear` and Cartesia's
`cancel` genuinely discard queued audio; single-context ElevenLabs has no cancel
at all and the provider has to reconnect. The contract promises the session
stays usable afterwards, not that the provider could actually drop the work.

### TTSEvent

**In plain words:** while the voice is being made, the service tells you things
— here's some sound, here's which word it was, I finished, something's odd.

```ts
type TTSEvent =
    | { type: "audio"; data: Uint8Array; offset?: number }
    | { type: "timing"; alignment: Alignment }
    | { type: "flushed"; id?: string | number }
    | { type: "cleared"; id?: string | number }
    | { type: "done" }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    | { type: "warning"; message: string; code?: string };
```

Why a union instead of just bytes: the `flushed`/`cleared` acks carry sequence
ids that tell a voice agent **which audio survived a barge-in**, and `timing` is
how you drive a caption track. Throwing those away at the core boundary would
force every serious consumer to reach past the SDK.

Fatal errors are _not_ events — they reject the `output` iterator, so a plain
`try`/`catch` around `for await` works.

### STTEvent and Finality

**In plain words:** while someone talks, the computer keeps changing its guess.
First "I _think_ you said hello", then "you definitely said hello", then "and
you've stopped talking now". Those are three different messages, and a robot
that answers you needs the third one to know when to speak.

```ts
type Finality = "partial" | "final" | "turn_end";

interface STTTranscriptEvent {
    type: "transcript";
    finality: Finality;
    text: string;      // cumulative text of the current turn
    delta: string;     // only what is new since the last event
    turn: number;
    start?: number;
    end?: number;
    words?: TranscriptWord[];
    language?: string;
    confidence?: number;
    endOfTurnConfidence?: number;
    raw?: unknown;
}

type STTEvent =
    | STTTranscriptEvent
    | { type: "speech_started"; at?: number }
    | { type: "speech_ended"; at?: number }
    | { type: "metadata"; requestId?: string; model?: string; raw?: unknown }
    | { type: "warning"; message: string; code?: string };
```

`Finality` has three states because a boolean cannot hold what providers
actually send:

| Provider               | What they send                                                |
| ---------------------- | ------------------------------------------------------------- |
| Deepgram (nova-3)      | `is_final` **and** `speech_final` — two independent flags     |
| Deepgram (Flux)        | 5 turn events, incl. a revocable `EagerEndOfTurn`             |
| ElevenLabs             | partial → final → committed — three levels                    |
| Cartesia (ink-2)       | `turn.update` / `turn.eager_end` ⇄ `turn.resume` / `turn.end` |
| Cartesia (ink-whisper) | `is_final`, but only after you explicitly ask                 |
| OpenAI                 | `delta` → `completed`                                         |

`partial` means "will be revised", `final` means "this segment is stable but the
turn may continue", `turn_end` means "the speaker is done".

### text _and_ delta

**In plain words:** some services send you only the new words; others resend the
whole sentence every time. Core gives you both, always, so you never have to
care which one you're talking to.

Providers genuinely split three ways — OpenAI and Cartesia's manual mode send
deltas, Cartesia's auto mode and AssemblyAI resend the whole turn, Deepgram
sends per-segment text. `TurnTextTracker` in
[`turn-text.ts`](../packages/core/src/turn-text.ts) derives whichever one the
provider did not send:

```ts
const tracker = new TurnTextTracker();

tracker.fromDelta(" world")     // provider sent only what's new
tracker.fromCumulative(text)    // provider resent the whole turn
tracker.fromSegment(text)       // provider's text is scoped to a segment

tracker.commitSegment()         // segment stable, turn continues
tracker.endTurn()               // speaker finished; turn counter advances

tracker.text                    // cumulative text of the turn in progress
tracker.turn                    // current turn number
```

All three return `{ text, delta, turn }`. It lives in core because every
realtime STT provider needs it, and each one would otherwise get it subtly wrong
in its own way.

### TurnDetection

```ts
type TurnDetection =
    | { mode: "manual" }
    | { mode: "vad"; silence?: number; threshold?: number; minSpeech?: number };
```

`manual` puts turn boundaries under the caller's control via `flush()` —
push-to-talk. `vad` lets the provider detect them. This is not cosmetic: on
Cartesia it selects a **different endpoint and a different model**, and
Cartesia's `ink-whisper` has no turn detection whatsoever, so without `manual`
you would get silence back forever.

---

## Layer 4 — providers and the facade

[`packages/core/src/provider.ts`](../packages/core/src/provider.ts)

```ts
interface Capabilities {
    tts: boolean;          // speak, speakStream
    stt: boolean;          // transcribe
    realtimeTTS: boolean;  // openTTSSession
    realtimeSTT: boolean;  // openSTTSession
}

interface VoiceProvider {
    readonly name: string;
    readonly capabilities: Readonly<Capabilities>;

    speak?(input: SpeakInput, context?: RequestContext): Promise<SpeakResult>;
    speakStream?(input: SpeakInput, context?: RequestContext): AudioStream;
    transcribe?(input: TranscribeInput, context?: RequestContext): Promise<TranscriptResult>;
    openTTSSession?(input?: RealtimeTTSInput): Promise<TTSSession>;
    openSTTSession?(input?: RealtimeSTTInput): Promise<STTSession>;

    listVoices?(): Promise<VoiceInfo[]>;
    close?(): Promise<void>;
}
```

**The invariant: if a capability flag is `true`, its method(s) must exist.** The
flags are a promise, not a wish. A provider that has not implemented `speak` yet
sets `tts: false`, even if the underlying API supports it.

`Voice` in [`voice.ts`](../packages/core/src/voice.ts) is the entry point users
touch. It holds a provider, merges constructor defaults into the per-call
`RequestContext`, and throws `CapabilityError` when you call something the
provider does not implement:

```ts
const voice = new Voice({
    provider: new CartesiaProvider({ apiKey, defaultVoice }),
    options: { timeout: 30_000, retries: 2 },
});

const result = await voice.speak({ text: "Hello there" });
```

### Errors

[`packages/core/src/errors.ts`](../packages/core/src/errors.ts)

| Error             | Means                                    | Thrown when                       |
| ----------------- | ---------------------------------------- | --------------------------------- |
| `VoiceError`      | base class for everything                | —                                 |
| `CapabilityError` | this provider cannot do that at all      | calling a method it does not have |
| `ConfigError`     | the provider was set up wrong            | construction, e.g. missing key    |
| `ValidationError` | this request field cannot be represented | before the request goes out       |

`ValidationError` names the offending field, so you see
`format.sampleRate: 12345 is not supported. Supported: 8000, 16000, ...`
instead of a bare `400` from an API you have never read the docs for.

### Helpers

[`packages/core/src/stream.ts`](../packages/core/src/stream.ts)

```ts
audioOnly(events)  // TTSEvent stream -> just the Uint8Array chunks
turns(events)      // STTEvent stream -> just the turn_end transcripts
```

The event unions are lossless; these two cover the common cases so you do not
have to match on them by hand:

```ts
for await (const bytes of audioOnly(session.output)) speaker.write(bytes);
for await (const turn of turns(session.output)) reply(turn.text);
```

---

## The four rules

Everything above follows from four decisions. If you remember nothing else,
remember these.

**1. One vocabulary, one unit.** Times are seconds. Audio is `Uint8Array`.
Base64 is decoded by the provider before core ever sees it. Providers that speak
milliseconds convert on the way out.

**2. Loud about audio, quiet about style.** A format the provider cannot
represent **throws** `ValidationError` — wrong encoding produces unplayable
bytes, and you want to know at the call site. A `VoiceControls` knob the provider
lacks is **ignored** — the audio is still fine, just slightly different. The line
is: would being wrong here produce garbage, or merely something a bit different?

**3. Escape hatches in both directions.** `providerOptions` goes in untouched,
`raw` comes out untouched. Neither is ever required, and their existence means a
provider-specific feature never has to wait for a core release.

**4. Capability flags are a promise.** `true` means the method exists. Core
checks the method, not the flag, at call time — but a provider that lies makes
its own users miserable.

---

## Type index

| Type                                           | File           | What it is                         |
| ---------------------------------------------- | -------------- | ---------------------------------- |
| `AudioEncoding`                                | `audio.ts`     | how samples are written            |
| `AudioContainer`                               | `audio.ts`     | the wrapper around the samples     |
| `AudioFormat`                                  | `audio.ts`     | a format you asked for             |
| `ResolvedAudioFormat`                          | `audio.ts`     | the format you actually got        |
| `AudioSource`                                  | `audio.ts`     | any way of handing over audio      |
| `AudioChunk`                                   | `audio.ts`     | one frame of audio                 |
| `AudioStream`                                  | `audio.ts`     | chunks + the format they are in    |
| `TimingSpan` / `Alignment`                     | `audio.ts`     | which text happened when           |
| `collectAudio` / `concatAudio`                 | `audio.ts`     | flatten any source into one buffer |
| `RequestContext`                               | `types.ts`     | signal, timeout, retries           |
| `VoiceControls`                                | `types.ts`     | prosody knobs                      |
| `SpeakInput` / `SpeakResult`                   | `types.ts`     | batch TTS                          |
| `TranscribeInput` / `TranscriptResult`         | `types.ts`     | batch STT                          |
| `TranscriptWord` / `TranscriptSegment`         | `types.ts`     | recognized text with timing        |
| `RealtimeSession`                              | `realtime.ts`  | the duplex session contract        |
| `RealtimeTTSInput` / `TTSEvent` / `TTSSession` | `realtime.ts`  | realtime TTS                       |
| `RealtimeSTTInput` / `STTEvent` / `STTSession` | `realtime.ts`  | realtime STT                       |
| `Finality`                                     | `realtime.ts`  | partial / final / turn_end         |
| `TurnDetection`                                | `realtime.ts`  | manual vs VAD boundaries           |
| `Capabilities` / `VoiceProvider` / `VoiceInfo` | `provider.ts`  | the provider contract              |
| `Voice`                                        | `voice.ts`     | the entry point                    |
| `VoiceError` and friends                       | `errors.ts`    | typed failures                     |
| `audioOnly` / `turns`                          | `stream.ts`    | event stream filters               |
| `TurnTextTracker`                              | `turn-text.ts` | derives text ⇄ delta               |

Next: [building-a-provider.md](./building-a-provider.md) — how these types were
used to implement Cartesia, step by step.
