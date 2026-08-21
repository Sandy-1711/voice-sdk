# Building a provider

How `@swungstudent/cartesia` was built, in the order it was built, so you can do the
same for Deepgram, ElevenLabs or OpenAI without rediscovering anything.

Read [core-types.md](./core-types.md) first if you have not — this guide assumes
you know what `SpeakInput`, `TTSEvent` and `Finality` are.

**In plain words:** a provider is a translator between one company's API and the
shared shape everyone else in this SDK uses. This guide shows the seven pieces
that translator is made of, using the one we already finished as the example.

---

## The shape of a provider package

```
providers/cartesia/src/
├── config.ts          # API key, defaults, what to use when the caller says nothing
├── format.ts          # core AudioFormat  ->  Cartesia's spelling
├── tts.ts             # speak() and speakStream()
├── tts-session.ts     # openTTSSession()
├── stt.ts             # transcribe()
├── stt-session.ts     # openSTTSession()
├── provider.ts        # the class that implements VoiceProvider
├── index.ts           # public exports (the provider class + its config type)
└── internal/          # helpers nobody outside the package should import
```

One file per capability, plus two shared ones. `provider.ts` ends up as almost
pure delegation — that is the sign the split is right.

The package depends on `@swungstudent/voice` as a **peer** dependency, so an app
never ends up with two copies of core:

```jsonc
"peerDependencies": { "@swungstudent/voice": "workspace:^" },
"devDependencies":  { "@swungstudent/voice": "workspace:^" }
```

---

## Step 0 — research before you write

Before any code, answer four questions and write the answers down (ours are in
[provider-research.md](../provider-research.md) and [type-design.md](../type-design.md)):

1. **Which of the four capabilities does this provider actually have?** Not
   "could have" — has today, with an endpoint you can call.
2. **What are the exact field names, in both directions?** Build the mapping
   table before you build the mapper.
3. **What is the finality model for realtime STT?** This is where providers
   differ most and where a naive mapping loses information.
4. **Is there an official SDK, and how much does it already do?**

Question 4 changed the most for Cartesia. `@cartesia/cartesia-js@3.5` turned out
to ship a full WebSocket wrapper with context routing and a
`stream()` async-iterator — which meant the session files became mapping layers
instead of protocol implementations. Check `node_modules` before assuming you
must hand-roll a socket:

```bash
ls node_modules/@cartesia/cartesia-js/resources/
grep -n "declare class" node_modules/@cartesia/cartesia-js/resources/tts.d.ts
```

That five-minute check saved roughly two files' worth of work.

---

## Step 1 — config

[`providers/cartesia/src/config.ts`](../../providers/cartesia/src/config.ts)

**In plain words:** where the password lives, and what to do when the caller
does not say which voice or model they want.

Two types: what the user passes, and what the rest of the package sees after
defaults are filled in.

```ts
export interface CartesiaConfig {
    apiKey?: string;          // falls back to CARTESIA_API_KEY
    baseUrl?: string;
    defaultVoice?: string;
    defaultModel?: string;
    defaultSTTModel?: string;
    defaultFormat?: AudioFormat;
}

export interface ResolvedConfig { /* same, with the optionals resolved */ }

export function resolveConfig(config: CartesiaConfig): ResolvedConfig {
    const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
    if (!apiKey) {
        throw new ConfigError("cartesia", "apiKey",
            "Pass `apiKey` or set the CARTESIA_API_KEY environment variable.");
    }
    // ...
}
```

Missing credentials throw `ConfigError` at **construction**, not on first call.
A misconfigured provider should fail at startup where the stack trace points at
your setup code.

### The one judgment call here: default formats

Cartesia defines three:

```ts
DEFAULT_FORMAT        // wav,  pcm_s16le, 44100 — for speak()
DEFAULT_STREAM_FORMAT // raw,  pcm_s16le, 44100 — for speakStream() and sessions
DEFAULT_INPUT_FORMAT  // raw,  pcm_s16le, 16000 — for audio going in
```

Batch audio usually gets written to a file, so it carries a wav header. Streamed
audio goes to a speaker or a socket, where a header mid-stream is noise. Input
defaults to 16 kHz mono PCM because that is the one format every provider
accepts. The caller always learns which they got via `ResolvedAudioFormat`.

---

## Step 2 — format lowering

[`providers/cartesia/src/format.ts`](../../providers/cartesia/src/format.ts)

**In plain words:** everyone spells the same audio settings differently. This
file is the dictionary, and it shouts instead of guessing when there is no
translation.

This is the file that stops the abstraction from leaking. Four vocabularies for
one concept:

| Core                                                        | Cartesia                                                     | Deepgram                              | ElevenLabs      |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- | --------------- |
| `{container:"raw", encoding:"pcm_s16le", sampleRate:16000}` | `{container:"raw", encoding:"pcm_s16le", sample_rate:16000}` | `encoding=linear16&sample_rate=16000` | `pcm_16000`     |
| `{container:"raw", encoding:"mulaw", sampleRate:8000}`      | `{..., encoding:"pcm_mulaw", ...}`                           | `encoding=mulaw`                      | `ulaw_8000`     |
| `{container:"mp3", bitrate:128}`                            | `{container:"mp3", bit_rate:128000}`                         | ❌ throws                             | `mp3_44100_128` |

The mapping is a partial record so an encoding with no equivalent is a lookup
miss rather than a compile error:

```ts
const RAW_ENCODING: Partial<Record<AudioEncoding, Cartesia.RawEncoding>> = {
    pcm_s16le: "pcm_s16le",
    pcm_f32le: "pcm_f32le",
    mulaw: "pcm_mulaw",   // Cartesia prefixes telephony codecs with pcm_
    alaw: "pcm_alaw",
};
```

The signature takes what was requested plus what to fall back to, and returns
both the provider payload **and** the resolved format:

```ts
export function toOutputFormat(
    requested: AudioFormat | undefined,
    fallback: ResolvedAudioFormat,
): { payload: CartesiaOutputFormat; resolved: ResolvedAudioFormat }
```

Returning both in one call is what makes it impossible to forget to report the
resolved format back to the caller.

### Throw, do not substitute

```ts
if (!isSampleRate(sampleRate)) {
    throw new ValidationError("cartesia", "format.sampleRate",
        `${sampleRate} is not supported. Supported: ${SAMPLE_RATES.join(", ")}.`);
}
```

Silently rounding 12 kHz up to 16 kHz gives you audio that plays at the wrong
speed and a bug you find in production. The error names the field and lists the
valid values — that is the standard to hold every mapper to.

There is a second, stricter variant because Cartesia's SSE and WebSocket
endpoints only accept the `raw` container:

```ts
export function toRawOutputFormat(requested, fallback) {
    const { payload, resolved } = toOutputFormat(requested, fallback);
    if (payload.container !== "raw") {
        throw new ValidationError("cartesia", "format.container",
            `Streaming synthesis only supports the "raw" container, got "${payload.container}". Use speak() for ${payload.container}.`);
    }
    return { payload, resolved };
}
```

Note the error tells you what to do instead. Errors that name the alternative
save a documentation lookup.

### Controls: ignore what you cannot do, reject what you can

```ts
export function toGenerationConfig(controls?: VoiceControls) {
    if (!controls) return undefined;
    const config: Cartesia.GenerationConfig = {};
    if (controls.speed  !== undefined) config.speed  = inRange("controls.speed", controls.speed, 0.6, 1.5);
    if (controls.volume !== undefined) config.volume = inRange("controls.volume", controls.volume, 0.5, 2);
    if (controls.emotion !== undefined) config.emotion = controls.emotion as Cartesia.Emotion;
    return Object.keys(config).length > 0 ? config : undefined;
}
```

`stability`, `similarity`, `style` and `instructions` have no Cartesia
equivalent, so they are dropped without comment. But `speed: 5` **throws** —
the field is supported, the value is not, and Cartesia would have returned a
bare 400 anyway. That is the rule from
[core-types.md](./core-types.md#the-four-rules) applied concretely.

---

## Step 3 — batch TTS

[`providers/cartesia/src/tts.ts`](../../providers/cartesia/src/tts.ts)

**In plain words:** send all the words, get back all the sound.

```ts
async speak(input: SpeakInput, context?: RequestContext): Promise<SpeakResult> {
    const { payload, resolved } = toOutputFormat(
        input.format ?? this.#config.defaultFormat,
        DEFAULT_FORMAT,
    );

    const response = await this.#client.tts.generate(
        { ...this.#body(input), output_format: payload },
        requestOptions(context),
    );

    return {
        audio: new Uint8Array(await response.arrayBuffer()),
        format: resolved,
        requestId: response.headers.get("x-request-id") ?? undefined,
    };
}
```

Three things to copy:

1. **Format resolution first**, before the request — so a bad format throws
   without burning an API call.
2. **`resolved` goes back on the result.** Never make the caller guess.
3. **`RequestContext` maps to whatever the SDK calls it** — here
   `{ signal, timeout, maxRetries }`.

The request body is built once and shared, minus the parts that differ per
endpoint:

```ts
/** Everything but `output_format`, which differs per endpoint. */
#body(input: SpeakInput) {
    return {
        model_id: (input.model ?? this.#config.defaultModel) as Cartesia.TTSModel,
        transcript: input.text,                                  // not `text`
        voice: toVoice(input.voice ?? this.#config.defaultVoice),
        language: input.language as Cartesia.SupportedLanguage | undefined,
        generation_config: toGenerationConfig(input.controls),
        ...(input.providerOptions ?? {}),                         // escape hatch, last
    };
}
```

`providerOptions` is spread **last** so a caller can override anything the
mapper decided. That is the point of an escape hatch.

### speakStream returns an object, not a generator

`AudioStream` carries `format`, and an async generator cannot have properties.
So return an object literal that is iterable:

```ts
speakStream(input: SpeakInput, context?: RequestContext): AudioStream {
    const { payload, resolved } = toRawOutputFormat(/* ... */);
    const body = this.#body(input);
    const client = this.#client;

    return {
        format: resolved,
        async *[Symbol.asyncIterator]() {
            const events = await client.tts.generateSSE({ ...body, output_format: payload }, ...);
            for await (const event of events) {
                if (event.type === "chunk") yield { data: decodeBase64(event.data) };
            }
        },
    };
}
```

The method is **not** `async` — the format is known synchronously, so the caller
can configure playback before any network work starts. Capture `this.#client`
into a local first; inside `[Symbol.asyncIterator]`, `this` is the object
literal.

---

## Step 4 — batch STT

[`providers/cartesia/src/stt.ts`](../../providers/cartesia/src/stt.ts)

**In plain words:** send the recording, get back the words.

```ts
const response = await this.#client.stt.transcribe({
    file: await toFile(await collectAudio(input.audio), "audio"),
    model: (input.model ?? this.#config.defaultSTTModel) as Cartesia.STTBatchModel,
    language: input.language,
    encoding: toSTTEncoding(input.format),
    sample_rate: input.format?.sampleRate,
    // Word is the only granularity Cartesia offers.
    timestamp_granularities: input.timestamps ? ["word"] : undefined,
    ...(input.providerOptions ?? {}),
}, /* request options */);

return {
    text: response.text,
    duration: response.duration,
    language: response.language,
    requestId: response.request_id,          // not `uniqueId`
    words: response.words?.map((word) => ({
        text: word.word,                     // Cartesia says `word`, core says `text`
        start: word.start,
        end: word.end,
    })),
    raw: response,
};
```

`collectAudio` from core handles every `AudioSource` member — buffer, blob,
stream, or `{ url }` — so the provider only deals in bytes.

Note `words` stays `undefined` when the provider sent nothing, rather than
becoming `[]`. And `raw` carries the untouched response for anyone who needs a
field core does not model.

---

## Step 5 — realtime TTS session

[`providers/cartesia/src/tts-session.ts`](../../providers/cartesia/src/tts-session.ts)

**In plain words:** keep a line open. Feed it words as you think of them, and
sound comes back while you are still typing.

Cartesia requires a `context_id` on every message. A session owns exactly one
context, so callers never see it. The SDK's `TTSWSContext` already handles the
routing:

```ts
static async open(client, config, input: RealtimeTTSInput = {}) {
    const { payload, resolved } = toRawOutputFormat(input.format ?? config.defaultFormat, DEFAULT_STREAM_FORMAT);

    const ws = await client.tts.websocket();
    const context = ws.context({
        model_id: (input.model ?? config.defaultModel) as Cartesia.TTSModel,
        voice: toVoice(input.voice ?? config.defaultVoice),
        output_format: payload,
        add_timestamps: input.timings === true || input.timings === "word",
        add_phoneme_timestamps: input.timings === "phoneme",
        ...(input.providerOptions ?? {}),
    });

    return new CartesiaTTSSession(ws, context, resolved, toGenerationConfig(input.controls));
}
```

A `static open()` plus a private constructor, because connecting is async but
the constructor cannot be. `format` is a readonly field set during `open`, so
`session.format` is available before the first chunk.

### The verbs map one-to-one

```ts
push(text: string): void {
    void this.#context.push({ transcript: text, generation_config: this.#generationConfig })
        .catch(() => { /* surfaced on output */ });
}

async flush(): Promise<void> { await this.#context.flush(); }

cancel(): void { void this.#context.cancel().catch(() => { /* best-effort */ }); }

async close(): Promise<void> {
    await this.#context.no_more_inputs().catch(() => {});
    this.#ws.close();
    this.#onClosed();
}
```

`push` swallows its rejection **on purpose**: the contract says `push` never
throws, so the failure has to reach the caller through `output` instead. If
`push` returned a promise, every LLM token loop would need an await.

Cartesia's `cancel` is a real barge-in — the context is cancelled server-side
and queued audio is dropped. Not every provider can do that, which is why the
core contract only promises best-effort.

### Mapping the event stream

```ts
async *#events(): AsyncIterable<TTSEvent> {
    for await (const message of this.#context.receive()) {
        switch (message.type) {
            case "chunk":
                yield { type: "audio", data: decodeBase64(message.data) };
                break;
            case "timestamps": {
                const t = message.word_timestamps;
                if (t) yield { type: "timing", alignment: toAlignment(t.words, t.start, t.end, "word") };
                break;
            }
            case "flush_done":
                yield { type: "flushed", id: message.flush_id };
                break;
            case "done":
                yield { type: "done" };
                break;
            case "error":
                throw new VoiceError(`Cartesia TTS session: ${message.title}: ${message.message}`);
        }
    }
    this.#onClosed();
}
```

Base64 is decoded here, so core never sees an encoded string. Fatal errors are
**thrown**, which rejects the consumer's `for await` — they are not emitted as
events.

---

## Step 6 — realtime STT session

[`providers/cartesia/src/stt-session.ts`](../../providers/cartesia/src/stt-session.ts)

**In plain words:** the hardest one. The computer keeps changing its mind about
what you said, and different services change their minds in different ways.

Cartesia splits realtime STT across **two endpoints**, and `turnDetection` picks
between them:

| `turnDetection`      | Endpoint             | Model         | Behaviour                                    |
| -------------------- | -------------------- | ------------- | -------------------------------------------- |
| `{ mode: "vad" }`    | `stt.autoFinalize`   | `ink-2`       | detects turns, emits turn events             |
| `{ mode: "manual" }` | `stt.manualFinalize` | `ink-whisper` | **no** turn detection; `finalize` or nothing |

Getting this wrong is not a small bug — `ink-whisper` with no `finalize` returns
silence forever. So the mismatch is caught up front:

```ts
if (model.startsWith("ink-whisper")) {
    throw new ValidationError("cartesia", "model",
        `"${model}" has no turn detection. Use turnDetection: { mode: "manual" }, or the ink-2 model.`);
}
```

### Mapping finality — the part worth studying

**Auto mode** resends the whole turn on every event:

| Cartesia event   | Core                                   | Why                                            |
| ---------------- | -------------------------------------- | ---------------------------------------------- |
| `connected`      | `metadata`                             | carries `request_id`                           |
| `turn.start`     | `speech_started`                       | VAD signal, no timestamp available             |
| `turn.update`    | `transcript`, `partial`                | still being revised                            |
| `turn.eager_end` | `transcript`, `final`                  | predicted end — **revocable**, so not turn_end |
| `turn.resume`    | `transcript`, `partial`                | the prediction was wrong; turn continues       |
| `turn.end`       | `transcript`, `turn_end` → `endTurn()` | speaker is done                                |

`turn.eager_end` is exactly why `Finality` has three states. It is a stable
segment the model can still take back, which is neither "will be revised" nor
"the speaker is done".

**Manual mode** sends deltas scoped to the last final:

| Cartesia event                  | Core                                      |
| ------------------------------- | ----------------------------------------- |
| `transcript`, `is_final: false` | `transcript`, `partial`                   |
| `transcript`, `is_final: true`  | `transcript`, `final` → `commitSegment()` |
| `flush_done`                    | synthesized `transcript`, `turn_end`      |
| `done`                          | end the stream                            |

That `flush_done` mapping is the interesting one. Manual mode has no turn
concept at all, but a push-to-talk app still needs to know when to reply — so
the ack for "I finished draining your audio" becomes the turn boundary:

```ts
case "flush_done": {
    yield {
        type: "transcript",
        finality: "turn_end",
        text: this.#tracker.text,
        delta: "",
        turn: this.#tracker.turn,
        raw: message,
    };
    this.#tracker.endTurn();
    break;
}
```

Now `turns(session.output)` fires in both modes, and a consumer cannot tell
which endpoint it is talking to.

### Two modes, two tracker entry points

Because the modes disagree about what `text` even means, each uses the matching
`TurnTextTracker` method — and both come out with cumulative text _and_ a delta:

```ts
// manual: text is a delta relative to the last final
const { text, delta, turn } = this.#tracker.fromSegment(message.text);
if (message.is_final) this.#tracker.commitSegment();

// auto: transcript is the whole turn, resent every time
const { text, delta, turn } = this.#tracker.fromCumulative(message.transcript);
```

If you take one thing from this guide: **do not normalize by picking a side.**
Emit both and let core derive the other.

---

## Step 7 — wire it up

[`providers/cartesia/src/provider.ts`](../../providers/cartesia/src/provider.ts)

```ts
export class CartesiaProvider implements VoiceProvider {
    readonly name = "cartesia";
    readonly capabilities: Readonly<Capabilities> = {
        tts: true, stt: true, realtimeTTS: true, realtimeSTT: true,
    };

    constructor(config: CartesiaConfig = {}) {
        this.#config = resolveConfig(config);
        this.#client = new Cartesia({ apiKey: this.#config.apiKey, baseURL: this.#config.baseUrl });
        this.#tts = new CartesiaTTS(this.#client, this.#config);
        this.#stt = new CartesiaSTT(this.#client, this.#config);
    }

    speak(input, context)  { return this.#tts.speak(input, context); }
    speakStream(input, context) { return this.#tts.speakStream(input, context); }
    transcribe(input, context)  { return this.#stt.transcribe(input, context); }
    openTTSSession(input) { return CartesiaTTSSession.open(this.#client, this.#config, input); }
    async openSTTSession(input) { return CartesiaSTTSession.open(this.#client, this.#config, input); }
    // listVoices ...
}
```

Pure delegation, one shared client. **Be honest about the flags** — before
`speak` existed, `tts` was `false` even though the API supports it. The flag
describes your implementation, not the vendor's brochure.

`index.ts` exports the class and its config type, nothing else. Sessions and
engines stay internal so they can change without a breaking release.

---

## Verify it

Typecheck as you go, one capability at a time:

```bash
cd providers/<name> && ../../node_modules/.bin/tsc --noEmit
```

When it is all wired, prove the whole surface composes through `Voice`. Write a
throwaway file in `src/`, typecheck it, delete it:

```ts
const voice = new Voice({ provider: new CartesiaProvider({ apiKey: "x", defaultVoice: "v" }) });

const result = await voice.speak({ text: "hello", format: { container: "mp3", bitrate: 128 } });
const stream = voice.speakStream({ text: "hello" });
for await (const chunk of stream) chunk.data.byteLength;

const tts = await voice.openTTSSession({ timings: true });
tts.push("hello ");
await tts.flush();
for await (const bytes of audioOnly(tts.output)) bytes.byteLength;

const stt = await voice.openSTTSession({ turnDetection: { mode: "vad", silence: 1.2 } });
stt.push(new Uint8Array());
for await (const turn of turns(stt.output)) turn.text.trim();
```

This catches the mistakes unit tests miss — a session that does not satisfy the
interface, a helper that will not accept your event union, a format type that
does not line up.

Then build, to confirm declarations emit cleanly:

```bash
pnpm build     # tsup: esm + cjs + .d.ts
```

⚠️ **Typechecking is not testing.** Everything above proves the shapes line up;
it does not prove a single byte reached Cartesia. A smoke test against a live
key is a separate, necessary step.

---

## Checklist for the next provider

**Research**

- [ ] Capability matrix: which of the four, with a real endpoint
- [ ] Field mapping table, both directions, all four operations
- [ ] Finality model for realtime STT, written down before coding
- [ ] Check `node_modules` for an official SDK and what it already handles

**Build**

- [ ] `config.ts` — env fallback, `ConfigError` at construction, defaults
- [ ] `format.ts` — throw `ValidationError` naming the field; never substitute
- [ ] `speak` / `speakStream` — return `ResolvedAudioFormat`; format resolved before the call
- [ ] `transcribe` — `collectAudio` for input; `words` undefined when not requested
- [ ] `openTTSSession` — `static open()`, `push` never throws, decode base64 in the provider
- [ ] `openSTTSession` — map to `Finality`; use `TurnTextTracker`; emit both `text` and `delta`
- [ ] `provider.ts` — delegation only; capability flags match reality
- [ ] `index.ts` — export the provider class and its config type, nothing else

**Rules that apply everywhere**

- [ ] All times in **seconds**
- [ ] Base64 decoded before it reaches core
- [ ] `providerOptions` spread last so callers can override
- [ ] `raw` on every result
- [ ] Fatal errors reject the stream; non-fatal become `warning` events
- [ ] `ValidationError` for unrepresentable audio, silence for unsupported prosody

**Verify**

- [ ] `tsc --noEmit` clean
- [ ] Composition check through `Voice`
- [ ] `pnpm build` emits declarations
- [ ] Smoke test against a live key — the only step that proves it works
