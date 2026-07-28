# Core type design

Companion to [`provider-research.md`](./provider-research.md). That doc answers
*what each provider offers*; this one answers *what the shared types should be*
and proves it by mapping every field, in both directions, for all four
operations.

The types themselves live in [`core-types.draft.ts`](./core-types.draft.ts) —
compile-ready, no imports, meant to be dropped into `packages/core/src/`.

Verified against live provider docs on 2026-07-28.

---

## 1. The four operations

| Operation        | Input                          | Output                            | Transport                    |
| ---------------- | ------------------------------ | --------------------------------- | ---------------------------- |
| **TTS**          | complete text                  | complete audio (or chunked bytes) | HTTP POST / chunked / SSE    |
| **STT**          | complete audio                 | complete transcript               | HTTP POST multipart          |
| **realtime TTS** | text tokens, pushed over time  | audio frames as they generate     | WebSocket, duplex            |
| **realtime STT** | audio frames, pushed over time | transcript events as they arrive  | WebSocket, duplex            |

The load-bearing distinction: **realtime ≠ streaming output.** Every TTS
provider can stream audio *out* of a one-shot request. Only ElevenLabs,
Deepgram and Cartesia accept text *in* incrementally. OpenAI cannot — which is
why `speakStream()` sits under the `tts` capability and `openTTSSession()` sits
under `realtimeTTS`.

---

## 2. TTS — input mapping

Core: [`SpeakInput`](./core-types.draft.ts)

| Core field    | ElevenLabs                          | Deepgram          | Cartesia                       | OpenAI                 |
| ------------- | ----------------------------------- | ----------------- | ------------------------------ | ---------------------- |
| `text`        | `text` (body)                       | `text` (body)     | `transcript` (body)            | `input` (body)         |
| `model`       | `model_id`                          | `model` (query)   | `model_id`                     | `model`                |
| `voice`       | `{voice_id}` in **path**            | folded into `model`| `voice: {mode:"id", id}`      | `voice`                |
| `language`    | `language_code`                     | folded into `model`| `language`                    | ❌ (auto)              |
| `format`      | `output_format` query, **one string**| `encoding`+`sample_rate`+`container` query | `output_format: {container, encoding, sample_rate, bit_rate}` | `response_format` (name only) |
| `controls.speed` | `voice_settings.speed`           | `speed` query     | `generation_config.speed` 0.6–1.5 | `speed`             |
| `controls.volume`| ❌                               | ❌                | `generation_config.volume` 0.5–2.0 | ❌                 |
| `controls.stability` | `voice_settings.stability`   | ❌                | ❌                             | ❌                     |
| `controls.similarity`| `voice_settings.similarity_boost` | ❌           | ❌                             | ❌                     |
| `controls.style` | `voice_settings.style`           | ❌                | ❌                             | ❌                     |
| `controls.emotion`| ❌                              | ❌                | `generation_config.emotion`    | ❌                     |
| `controls.instructions` | ❌                        | ❌                | ❌                             | `instructions`         |
| `timings`     | `/with-timestamps` endpoint variant | ❌                | `add_timestamps`               | ❌                     |

Three observations that shaped the type:

- **Voice is a path segment on ElevenLabs and a model on Deepgram.** Keeping it
  a flat `voice?: string` and letting the provider decide where it goes is the
  only shape that works for both. Deepgram providers ignore `voice` unless
  `model` is unset, in which case they can accept a voice name as the model.
- **Format is the one field where vocabularies genuinely conflict.** Four
  spellings of the same concept, so core carries the decomposed form and each
  provider lowers it (§6).
- **`controls` is a grab bag by necessity.** No two providers overlap on more
  than `speed`. Making it one optional object with all-optional fields beats
  four provider-specific types, as long as the ignore-and-warn rule is loud.

## 3. TTS — output mapping

Core: `SpeakResult` / `AudioStream`

| Core field       | ElevenLabs                     | Deepgram        | Cartesia            | OpenAI            |
| ---------------- | ------------------------------ | --------------- | ------------------- | ----------------- |
| `audio`          | response body                  | response body   | response body       | response body     |
| `format`         | echo of request                | echo of request | echo of request     | echo of request   |
| `alignment`      | `alignment.{chars, charStartTimesMs, charDurationsMs}` | ❌ | `word_timestamps.{words, start, end}` | ❌ |
| `requestId`      | `request-id` header            | `dg-request-id` header | `x-request-id` header | `x-request-id` header |

Nobody returns the resolved format in the payload — it has to be echoed from
what the provider resolved client-side. That's why `ResolvedAudioFormat` exists
separately from `AudioFormat`: the provider fills the defaults it applied.

Alignment normalization is where the two shapes have to meet:

```
ElevenLabs  chars: ["H","e","l"], charStartTimesMs: [0,50,90], charDurationsMs: [50,40,60]
            -> spans: [{text:"H", start:0,    end:0.05},
                       {text:"e", start:0.05, end:0.09}, ...]     unit: "character"

Cartesia    words: ["Hello","there"], start: [0.0, 0.42], end: [0.40, 0.88]
            -> spans: [{text:"Hello", start:0, end:0.4}, ...]     unit: "word"
```

Parallel arrays and ms both die at the provider boundary.

---

## 4. STT — input/output mapping

Core: `TranscribeInput` / `TranscriptResult`

| Core field        | ElevenLabs                     | Deepgram              | Cartesia                    | OpenAI                     |
| ----------------- | ------------------------------ | --------------------- | --------------------------- | -------------------------- |
| `audio`           | `file` multipart or `source_url` | raw body or `{url}` JSON | `file` multipart        | `file` multipart (**25 MB cap**) |
| `model`           | `model_id` (`scribe_v2`)       | `model` query (`nova-3`) | `model` (`ink-whisper`)  | `model` (`gpt-4o-transcribe`) |
| `language`        | `language_code`                | `language` query      | `language`                  | `language`                 |
| `format`          | sniffed                        | `encoding`+`sample_rate` query | `encoding`+`sample_rate` | sniffed              |
| `timestamps`      | `timestamps_granularity`       | always on             | `timestamp_granularities[]` | `timestamp_granularities[]` (**whisper-1 only**) |
| `diarize`         | `diarize`                      | `diarize` query       | ❌                          | `gpt-4o-transcribe-diarize` model |
| `speakerCount`    | `num_speakers`                 | ❌                    | ❌                          | ❌                         |
| `keyterms`        | `keyterms`                     | `keyterm` query       | ❌ (ink-2 realtime only)     | ❌                         |
| `prompt`          | ❌                             | ❌                    | ❌                          | `prompt` (≤224 tok)        |

| Core output          | ElevenLabs             | Deepgram                                   | Cartesia     | OpenAI                    |
| -------------------- | ---------------------- | ------------------------------------------ | ------------ | ------------------------- |
| `text`               | `text`                 | `channel.alternatives[0].transcript`       | `text`       | `text`                    |
| `language`           | `language_code`        | `channel.alternatives[0].languages[0]`     | `language`   | `language` (verbose_json) |
| `languageConfidence` | `language_probability` | ❌                                         | ❌           | ❌                        |
| `duration`           | ❌ (multichannel only) | `metadata.duration`                        | `duration`   | `duration` (verbose_json) |
| `confidence`         | ❌                     | `alternatives[0].confidence`               | ❌           | ❌                        |
| `words[].text`       | `words[].text`         | `words[].word`                             | `words[].word` | `words[].word`          |
| `words[].start/end`  | seconds                | seconds                                    | seconds      | seconds                   |
| `words[].confidence` | `logprob` (**log scale**) | `confidence` (0–1)                      | ❌           | via `include: ["logprobs"]` |
| `words[].speaker`    | `speaker_id`           | `speaker` (int)                            | ❌           | diarize model only        |
| `words[].punctuated` | ❌                     | `punctuated_word`                          | ❌           | ❌                        |
| `words[].kind`       | `type`                 | ❌                                         | ❌           | ❌                        |
| `segments`           | ❌                     | derivable                                  | ❌           | `segments` (verbose_json) |
| `requestId`          | header                 | `metadata.request_id`                      | `request_id` | header                    |

Two traps worth encoding in the type rather than the docs:

- **ElevenLabs `logprob` is not a probability.** Providers must convert
  (`Math.exp(logprob)`) or leave `confidence` undefined. Passing it through
  raw would silently mean "confidence: -0.3".
- **AssemblyAI (out of scope for v0, in scope for the type) reports ms.**
  `TranscriptWord.start/end` being documented as seconds is what stops that
  from becoming a per-provider surprise.

---

## 5. Realtime mapping

### 5.1 Realtime TTS — session lifecycle

| Core call            | ElevenLabs                                 | Deepgram              | Cartesia                                  |
| -------------------- | ------------------------------------------ | --------------------- | ----------------------------------------- |
| `openTTSSession()`   | connect `/v1/text-to-speech/{voice}/stream-input`, then send `{text:" ", voice_settings, generation_config}` | connect `/v1/speak?model=…&encoding=…` | connect `/tts/websocket`, mint a `context_id` |
| `push(text)`         | `{text: "… "}` — **trailing space required** | `{type:"Speak", text}` | full JSON body + `context_id` + `continue: true` |
| `flush()`            | `{text:"", flush:true}`                    | `{type:"Flush"}`      | `{context_id, flush: true}`               |
| `cancel()`           | ❌ no cancel — close + reopen, or use multi-context `close_context` | `{type:"Clear"}` | `{context_id, cancel: true}` |
| `close()`            | `{text: ""}`                               | `{type:"Close"}`      | `{context_id, continue: false}`           |

| Core event  | ElevenLabs                          | Deepgram                           | Cartesia                              |
| ----------- | ----------------------------------- | ---------------------------------- | ------------------------------------- |
| `audio`     | `{audio: "<base64>"}`               | **binary frame**                   | `{type:"chunk", data:"<base64>"}`     |
| `timing`    | `alignment` / `normalizedAlignment` | ❌                                 | `{type:"timestamps"\|"phoneme_timestamps"}` |
| `flushed`   | ❌                                  | `{type:"Flushed", sequence_id}`    | `{type:"flush_done", flush_id}`       |
| `cleared`   | ❌                                  | `{type:"Cleared", sequence_id}`    | ❌ (cancel is silent)                  |
| `done`      | `{isFinal: true}`                   | ❌                                 | `{type:"done"}`                       |
| `metadata`  | ❌                                  | `{type:"Metadata", request_id, model_name}` | ❌                           |
| `warning`   | ❌                                  | `{type:"Warning", description, code}` | `{type:"error", …}` (fatal)        |

Why `TTSEvent` is a union and not just `AsyncIterable<Uint8Array>`: the
`flushed`/`cleared` acks carry sequence ids that a voice agent needs to know
which audio survived a barge-in, and `timing` is how you drive a caption track.
Throwing that away at the core boundary means every serious consumer has to
reach past the SDK. `audioOnly()` covers the simple case in one line.

**Context ids.** Cartesia *requires* `context_id` on every message; ElevenLabs
has a separate multi-context endpoint (`/multi-stream-input`) where
`initialiseContext` / `closeContext` / `keepContextAlive` operate per context
and audio comes back tagged with `contextId`. Deepgram has no equivalent. v0
keeps **one context per session** — `openTTSSession()` twice for two contexts —
and `contextId` rides along on events so the field doesn't have to be
retrofitted later.

### 5.2 Realtime STT — session lifecycle

| Core call            | ElevenLabs                        | Deepgram (`nova-3`)   | Deepgram (`flux`)     | Cartesia                | OpenAI                          |
| -------------------- | --------------------------------- | --------------------- | --------------------- | ----------------------- | ------------------------------- |
| `openSTTSession()`   | connect `/v1/speech-to-text/realtime` | connect `/v1/listen` | connect `/v2/listen` | connect `/stt/websocket` | connect `/v1/realtime`, then `session.update` with `type:"transcription"` |
| `push(bytes)`        | `{message_type:"input_audio_chunk", audio_base_64}` | **binary frame** | **binary frame** | **binary frame** | `{type:"input_audio_buffer.append", audio:"<base64>"}` |
| `flush()`            | `{…, commit: true}`               | `{type:"Finalize"}`   | ❌ (model-driven)     | `"finalize"` — **bare string** | `{type:"input_audio_buffer.commit"}` |
| `close()`            | socket close                      | `{type:"CloseStream"}`| socket close          | `"close"` — bare string | socket close                    |
| *heartbeat*          | `inactivity_timeout` query        | **`{type:"KeepAlive"}` every ~10 s, mandatory** | same | ❌                     | ❌                              |

| Core event         | ElevenLabs                                | Deepgram (`nova-3`)                   | Deepgram (`flux`)                 | Cartesia                     | OpenAI                                            |
| ------------------ | ----------------------------------------- | ------------------------------------- | --------------------------------- | ---------------------------- | ------------------------------------------------- |
| `transcript` partial | `partial_transcript`                    | `Results` + `is_final:false`          | `TurnInfo` + `event:"Update"`     | `transcript` + `is_final:false` | `…input_audio_transcription.delta`             |
| `transcript` final | `final_transcript`                        | `Results` + `is_final:true`           | `TurnInfo` + `event:"EagerEndOfTurn"` | `transcript` + `is_final:true` | ❌                                            |
| `transcript` turn_end | `committed_transcript`                 | `Results` + `speech_final:true`       | `TurnInfo` + `event:"EndOfTurn"`  | after `finalize`             | `…input_audio_transcription.completed`            |
| `speech_started`   | ❌                                        | `SpeechStarted` (needs `vad_events`)  | `TurnInfo` + `event:"StartOfTurn"`| ❌                           | `input_audio_buffer.speech_started`               |
| `speech_ended`     | ❌                                        | `UtteranceEnd` + `last_word_end`      | ❌                                | ❌                           | `input_audio_buffer.speech_stopped`               |
| `words`            | `*_with_timestamps` variants              | `channel.alternatives[0].words`       | `words[]` with `confidence`       | `words[]`                    | ❌                                                |
| `endOfTurnConfidence` | ❌                                     | ❌                                    | `end_of_turn_confidence`          | ❌                           | ❌                                                |
| `metadata`         | `session_started` + `session_id`          | `Metadata`                            | `Connected` + `request_id`        | `request_id` on each event   | `transcription_session.created`                   |

This table is the argument for the whole design:

1. **`isFinal: boolean` cannot express this.** Deepgram's `is_final` and
   `speech_final` are two different questions; ElevenLabs has three levels;
   Flux has five event kinds. `Finality = partial | final | turn_end` is the
   smallest thing that maps from all of them without inventing information.
   `TurnResumed` (Flux revoking an eager end-of-turn) is the one event with no
   home — it surfaces as a `partial` for the same `turn`, which is behaviourally
   correct: the turn didn't end after all.
2. **Delta vs cumulative is a real fork.** OpenAI and Cartesia send deltas,
   AssemblyAI resends the whole turn, Deepgram sends per-segment text.
   `STTTranscriptEvent` carries `text` *and* `delta`, and `TurnTextTracker`
   derives whichever one the provider didn't send, so no consumer has to ask.
3. **`flush()` means "finalize" on the STT side.** Cartesia `ink-whisper` has no
   endpointing at all, so without an explicit finalize you get nothing. Same
   verb, same intent as TTS flush; different wire message.

---

## 6. Format lowering

The rule: **the provider resolves the request into a `ResolvedAudioFormat` and
throws `ValidationError` if the combination is unrepresentable.** No silent
substitution — wrong sample rate on a phone line is a bug you find in
production.

| Core                                                  | ElevenLabs      | Deepgram                             | Cartesia                                              | OpenAI              |
| ----------------------------------------------------- | --------------- | ------------------------------------ | ----------------------------------------------------- | ------------------- |
| `{container:"mp3", sampleRate:44100, bitrate:128}`     | `mp3_44100_128` | ❌ throws                            | `{container:"mp3", sample_rate:44100, bit_rate:128000}`| `mp3` (rate ignored → warn) |
| `{container:"raw", encoding:"pcm_s16le", sampleRate:16000}` | `pcm_16000` | `encoding=linear16&sample_rate=16000` | `{container:"raw", encoding:"pcm_s16le", sample_rate:16000}` | ❌ (`pcm` is 24 kHz only) |
| `{container:"raw", encoding:"mulaw", sampleRate:8000}` | `ulaw_8000`     | `encoding=mulaw&sample_rate=8000`    | `{container:"raw", encoding:"pcm_mulaw", sample_rate:8000}` | ❌ throws     |
| `{container:"raw", encoding:"pcm_f32le", sampleRate:44100}` | ❌ throws  | ❌ throws                            | `{container:"raw", encoding:"pcm_f32le", sample_rate:44100}` | ❌ throws     |

Spelling differences the provider layer absorbs: Deepgram `linear16` /
`linear32`, Cartesia's `pcm_` prefix on µ-law and A-law (`pcm_mulaw`,
`pcm_alaw`), ElevenLabs' single fused string, OpenAI's bare container name.

The distinction that decides throw-vs-warn: **OpenAI ignoring `sampleRate` on
mp3 is a warning** (the decoder reads the header, the audio is fine);
**OpenAI being asked for 16 kHz PCM is a throw** (you'd get 24 kHz bytes
labelled 16 kHz and hear chipmunks).

---

## 7. What each provider needs at connect time

Realtime formats are query params on the handshake — they cannot be changed
per-message on any provider. This is why `RealtimeSTTInput.inputFormat` and
`RealtimeTTSInput.format` are session-scoped and `push()` takes nothing but
payload.

| Provider   | Realtime TTS handshake needs        | Realtime STT handshake needs                  |
| ---------- | ----------------------------------- | --------------------------------------------- |
| ElevenLabs | voice (path), `model_id`, `output_format`, `auto_mode`, `sync_alignment` | `model_id`, `audio_format`, `commit_strategy`, VAD thresholds |
| Deepgram   | `model`, `encoding`, `sample_rate`, `speed` | `model`, `encoding`, `sample_rate`, `interim_results`, `endpointing`, `vad_events`, `utterance_end_ms` |
| Cartesia   | `cartesia_version`; format per message but must stay constant per context | `model`, `encoding`, `sample_rate`, `cartesia_version`, `min_volume`, `max_silence_duration_secs` |
| OpenAI     | n/a                                 | `intent=transcription`, then `session.update` with format + model + turn detection |

Core default when `inputFormat` is unset:
`{container:"raw", encoding:"pcm_s16le", sampleRate:16000, channels:1}` — the
only combination all four accept.

---

## 8. Typed provider options (opt-in)

`providerOptions?: Record<string, unknown>` keeps core simple, but the escape
hatch can be typed without touching the shared types, since `Voice` is already
generic over the provider:

```ts
export interface ProviderOptionsMap {
  speak?: unknown;
  transcribe?: unknown;
  ttsSession?: unknown;
  sttSession?: unknown;
}

export interface VoiceProvider<TOpts extends ProviderOptionsMap = ProviderOptionsMap> {
  speak?(input: SpeakInput & { providerOptions?: TOpts["speak"] }): Promise<SpeakResult>;
  // …
}

// provider side
interface CartesiaOptions extends ProviderOptionsMap {
  speak: { pronunciation_dict_id?: string; max_buffer_delay_ms?: number };
}
export class CartesiaProvider implements VoiceProvider<CartesiaOptions> { /* … */ }
```

`Voice<TProvider>` then infers the right option type per call with no extra
annotation. Worth doing, but it's additive — ship the untyped version first.

---

## 9. Deliberate omissions

- **Multi-context sessions.** `contextId` is on the events; the API to open a
  second context isn't. Only Cartesia and ElevenLabs support it and the
  ergonomics need a real use case first.
- **Word-level streaming timings on realtime TTS.** Modelled as `timing` events,
  but only Cartesia and ElevenLabs emit them.
- **Cloning, voice design, dubbing, S2S.** Out of scope per the research doc.
- **`Capabilities` as a static object.** It says *whether* a provider does
  realtime TTS, not *which formats* it accepts — so unsupported-format errors
  are runtime, not compile-time. A `supportedFormats` descriptor could fix that
  later; it isn't worth the surface area now.
