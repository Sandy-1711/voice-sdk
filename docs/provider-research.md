# Provider Research

Research pass over all six target providers before locking the core contract.
Scope is deliberately narrowed to **four capabilities**: `tts`, `stt`,
`realtimeTTS`, `realtimeSTT`. Voice cloning, voice design, dubbing, sound
effects, and speech-to-speech are explicitly **out of scope** for v0.

Last verified: 2026-07-28.

The type surface this research produced lives in [type-design.md](./type-design.md)
(field-by-field mapping tables) and [core-types.draft.ts](./core-types.draft.ts)
(the types themselves).

---

## 1. Capability matrix

| Provider       | `tts` | `stt` | `realtimeTTS` | `realtimeSTT` |
| -------------- | :---: | :---: | :-----------: | :-----------: |
| **ElevenLabs** |  ✅   |  ✅   |      ✅       |      ✅       |
| **Deepgram**   |  ✅   |  ✅   |      ✅       |      ✅       |
| **Cartesia**   |  ✅   |  ✅   |      ✅       |      ✅       |
| **OpenAI**     |  ✅   |  ✅   |      ❌       |      ✅       |
| **AssemblyAI** |  ❌   |  ✅   |      ❌       |      ✅       |
| **Groq**       |  ✅   |  ✅   |      ❌       |      ❌       |

### What the capability names mean

The most important definitional decision, because "realtime TTS" is ambiguous
and providers split along the seam:

- **`tts`** — one-shot synthesis *and* HTTP output-streaming. Full text goes in,
  audio comes back (either buffered or as a chunked/SSE response). Every
  provider with TTS supports both.
- **`realtimeTTS`** — a **duplex WebSocket session**: push text *incrementally*
  (LLM tokens) while audio streams back. This is a genuinely different
  capability, and it is where OpenAI and Groq drop out.
- **`stt`** — batch transcription of a complete audio file.
- **`realtimeSTT`** — duplex WebSocket: push audio frames live, receive
  incremental transcripts.

> ⚠️ **OpenAI can stream TTS audio out** (chunked transfer / `stream_format=sse`)
> but cannot accept streamed text *in*. Under this definition it is
> `tts: true, realtimeTTS: false`, and `speakStream()` still works. This
> distinction must be documented loudly or users will file bugs.

---

## 2. Per-provider detail

### 2.1 ElevenLabs

**Auth:** `xi-api-key: <key>` header. Browser-safe path: single-use token via
`token` query param.
**Base:** `https://api.elevenlabs.io` (regional variants: `api.us.`, `api.eu.residency.`, `api.in.residency.`, `api.sg.residency.`)

| Capability      | Endpoint                                              |
| --------------- | ----------------------------------------------------- |
| `tts`           | `POST /v1/text-to-speech/{voice_id}` (+ `/stream`)     |
| `stt`           | `POST /v1/speech-to-text` — **multipart/form-data**    |
| `realtimeTTS`   | `WSS /v1/text-to-speech/{voice_id}/stream-input`       |
| `realtimeTTS`   | `WSS /v1/text-to-speech/{voice_id}/multi-stream-input` (multi-context) |
| `realtimeSTT`   | `WSS /v1/speech-to-text/realtime` (Scribe v2 Realtime) |

**TTS body:** `text`, `model_id` (default `eleven_multilingual_v2`),
`voice_settings{stability, similarity_boost, style, speed, use_speaker_boost}`,
`language_code`, `seed`, `previous_text`, `next_text`, `apply_text_normalization`.

**Output format** is a single opaque string on the query param — not decomposed:
`mp3_44100_128` (default), `mp3_{22050,24000,44100}_{32,48,64,96,128,192}`,
`pcm_{8000,16000,22050,24000,32000,44100,48000}`, `opus_48000_{32..192}`,
`wav_{8000..48000}`, `ulaw_8000`, `alaw_8000`.

**STT:** `model_id` must be `scribe_v2` or `scribe_v1`. Takes `file` (binary,
<5GB) **or** `source_url`. Options: `language_code`, `diarize`, `num_speakers`
(≤32), `timestamps_granularity` (`none|word|character`), `tag_audio_events`,
`use_multi_channel`, `keyterms`, `entity_detection`, `webhook`.
Response: `{ language_code, language_probability, text, words[{text, start, end, type, speaker_id, logprob, characters}] }`.

**Realtime TTS protocol** (text in → audio out):
```jsonc
// 1. handshake — note the single-space text
{ "text": " ", "voice_settings": {...}, "generation_config": { "chunk_length_schedule": [120,160,250,290] } }
// 2. push
{ "text": "Hello there ", "flush": false }   // trailing space is REQUIRED
// 3. close
{ "text": "" }
// server →
{ "audio": "<base64>", "alignment": { "chars": [...], "charStartTimesMs": [...], "charDurationsMs": [...] } }
{ "isFinal": true }
```
Query params: `model_id`, `language_code`, `output_format`, `auto_mode`,
`sync_alignment`, `inactivity_timeout`, `enable_ssml_parsing`, `seed`.

**Realtime STT protocol** (audio in → text out):
```jsonc
// client →
{ "message_type": "input_audio_chunk", "audio_base_64": "...", "commit": true, "sample_rate": 16000 }
// server →  message_type is one of:
//   session_started | partial_transcript | final_transcript |
//   final_transcript_with_timestamps | committed_transcript |
//   committed_transcript_with_timestamps | committed_transcript_entities
```
Query params: `model_id`, `audio_format` (`pcm_{8000..48000}` | `ulaw_8000`,
default `pcm_16000`), `language_code`, `commit_strategy` (`manual` | `vad`),
`vad_threshold`, `vad_silence_threshold_secs`, `min_speech_duration_ms`,
`include_timestamps`, `include_language_detection`, `keyterms`.

**Multi-context TTS** (`/multi-stream-input`): several independent generations
share one socket, each keyed by `context_id`. Client messages are
`initialiseContext`, `sendText`, `{context_id, flush:true}`,
`{context_id, close_context:true}`, `{close_socket:true}` and `keepContextAlive`
(empty text). Server audio comes back tagged with `contextId`. This is the only
ElevenLabs path that supports real interruption — the single-context socket has
no cancel.

**Quirks:** audio is **base64 in JSON, both directions** (not binary frames —
unlike everyone else). Trailing space on pushed text is load-bearing.
Three-level finality: partial → final → committed.

---

### 2.2 Deepgram

**Auth:** `Authorization: Token <key>` header, or `access_token` query param.
**Base:** `https://api.deepgram.com` / `wss://api.deepgram.com`

| Capability    | Endpoint             |
| ------------- | -------------------- |
| `tts`         | `POST /v1/speak`     |
| `stt`         | `POST /v1/listen`    |
| `realtimeTTS` | `WSS /v1/speak`      |
| `realtimeSTT` | `WSS /v1/listen` (nova-3) or `WSS /v2/listen` (Flux) |

Deepgram is the cleanest fit: same path for batch and realtime, config entirely
via query params, no per-request JSON schema differences.

**STT params:** `model` (`nova-3`, `nova-2`, `enhanced`, `base`), `language`,
`encoding` (`linear16`, `opus`, `flac`, `mulaw`, `alaw`), `sample_rate`,
`channels`, `interim_results`, `endpointing` (ms, default 10),
`utterance_end_ms`, `vad_events`, `smart_format`, `punctuate`, `diarize`.

**Realtime STT messages:**
```jsonc
// client → binary audio frames, plus JSON control:
{ "type": "KeepAlive" }    // REQUIRED every ~10s or the socket closes
{ "type": "Finalize" }
{ "type": "CloseStream" }
// server →
{ "type": "Results", "is_final": true, "speech_final": false,
  "channel": { "alternatives": [{ "transcript": "...", "confidence": 0.95,
                                  "words": [{ "word","start","end","confidence" }] }] } }
{ "type": "SpeechStarted", "channel": [0], "timestamp": 0.25 }
{ "type": "UtteranceEnd", "channel": [0], "last_word_end": 1.2 }
{ "type": "Metadata", "request_id": "...", "duration": 2.0, "channels": 1 }
```

**Realtime TTS messages:**
```jsonc
{ "type": "Speak", "text": "Your text here" }
{ "type": "Flush" }   // → server sends { "type": "Flushed", "sequence_id": n }
{ "type": "Clear" }   // barge-in → { "type": "Cleared", "sequence_id": n }
{ "type": "Close" }
// server → binary audio frames + Metadata / Warning
```
TTS params: `model` (default `aura-asteria-en`, 100+ voices), `encoding`
(`linear16` | `mulaw` | `alaw`, default `linear16`), `sample_rate` (8000, 16000,
24000 default, 32000, 48000), `speed`.

**Flux — a second, turn-shaped realtime STT** (`WSS /v2/listen`, models
`flux-general-en` / `flux-general-multi`). Instead of interim/final transcripts
it emits turn lifecycle events:
```jsonc
{ "type": "Connected", "request_id": "...", "sequence_id": 0 }
{ "type": "TurnInfo", "event": "StartOfTurn" | "Update" | "EagerEndOfTurn"
                             | "TurnResumed" | "EndOfTurn",
  "turn_index": 0, "audio_window_start": 0.0, "audio_window_end": 1.8,
  "transcript": "...", "words": [{ "word", "confidence", "start", "end" }],
  "end_of_turn_confidence": 0.91 }
```
Params: `eot_threshold` (default 0.7), `eager_eot_threshold`, `eot_timeout_ms`
(default 5000), plus the usual `encoding` / `sample_rate`. `EagerEndOfTurn` is a
speculative boundary that `TurnResumed` can revoke — useful for starting an LLM
call early, and the one event with no clean slot in a 3-state finality model
(it maps back to `partial`).

**Quirks:** **`KeepAlive` is mandatory** — the session layer needs a heartbeat.
Two-level finality (`is_final` = segment stable, `speech_final` = endpoint hit)
on nova-3, turn events on Flux. `Clear` gives us true barge-in, which most
providers lack. `Results` also carries `from_finalize` so you can tell an
app-triggered finalization from a natural one.

---

### 2.3 Cartesia

**Auth:** `Authorization: Bearer sk_car_...` (or `X-API-Key`), **plus a required
`Cartesia-Version: 2026-03-01` header** (query param `cartesia_version` on WS).
Browser path: JWT `access_token`.
**Base:** `https://api.cartesia.ai` / `wss://api.cartesia.ai`

| Capability    | Endpoint                                     |
| ------------- | -------------------------------------------- |
| `tts`         | `POST /tts/bytes` (+ `/tts/sse` for streaming) |
| `stt`         | batch HTTP                                    |
| `realtimeTTS` | `WSS /tts/websocket`                          |
| `realtimeSTT` | `WSS /stt/websocket`                          |

**TTS body:** `model_id` (`sonic-3.5`, `sonic-3`, `sonic-latest`), `transcript`
(**not** `text`), `voice: { mode: "id", id }`, `output_format: { container, encoding, sample_rate }`,
`language`, `generation_config: { volume 0.5–2.0, speed 0.6–1.5, emotion }`.
Containers: `wav` | `mp3` | `raw`. Encodings: `pcm_f32le`, `pcm_s16le`,
`pcm_mulaw`, `pcm_alaw`. Sample rates: 8000/16000/22050/24000/44100/48000.

**Realtime TTS:** same JSON body plus `context_id` (**required**), `continue`,
`flush`, `add_timestamps`, `add_phoneme_timestamps`, `use_normalized_timestamps`,
`max_buffer_delay_ms` (0–5000, default 3000), `pronunciation_dict_id`. Cancel
with `{ "context_id": "...", "cancel": true }`.
Server: `{"type":"chunk","data":"<base64>","context_id","step_time"}`,
`{"type":"done"}`, `{"type":"timestamps","word_timestamps":{words,start,end}}`,
`{"type":"phoneme_timestamps"}`, `{"type":"flush_done","flush_id"}`,
`{"type":"error"}`. Every message carries `context_id`, `status_code` and `done`.

**Realtime STT:** query params `model` (`ink-2` | `ink-whisper`), `encoding`
(`pcm_s16le` | `pcm_s32le` | `pcm_f16le` | `pcm_f32le` | `pcm_mulaw` | `pcm_alaw`),
`sample_rate`, `cartesia_version`, `language`, `min_volume`,
`max_silence_duration_secs` (ink-whisper only), `keyterm` (ink-2 only, ≤100).
Client sends **binary audio frames** plus the *text* commands `finalize` and
`close`. Server:
```jsonc
{ "type": "transcript", "is_final": false, "request_id": "...", "text": "delta", "duration": 1.2, "words": [...] }
{ "type": "flush_done", "request_id": "..." }
{ "type": "done", "request_id": "..." }
```

**Quirks:** the `context_id` continuation model maps *very* cleanly onto
`push`/`flush`. But **`ink-whisper` has no automatic turn detection** — you must
send `finalize` explicitly. Control messages are bare strings, not JSON.
Field is `transcript`, not `text`, on the TTS side.

---

### 2.4 OpenAI

**Auth:** `Authorization: Bearer <key>`. Browser path: ephemeral token.
**Base:** `https://api.openai.com` / `wss://api.openai.com`
Docs moved to `developers.openai.com/api/docs/...`.

| Capability    | Endpoint                                                     |
| ------------- | ------------------------------------------------------------ |
| `tts`         | `POST /v1/audio/speech`                                       |
| `stt`         | `POST /v1/audio/transcriptions`                               |
| `realtimeTTS` | ❌ — no text-in streaming session                              |
| `realtimeSTT` | `WSS /v1/realtime` with `session.type = "transcription"`       |

**TTS:** models `gpt-4o-mini-tts` (current), `tts-1`, `tts-1-hd`. Body: `model`,
`input`, `voice`, `instructions` (natural-language style control — no other
provider has this), `response_format`, `speed`, `stream_format`.
13 voices: `alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer,
verse, marin, cedar` (`marin`/`cedar` recommended; legacy models get 9).
Formats: `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm` (raw 24kHz s16).
Output streaming via chunked transfer encoding.

**STT:** models `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
`gpt-4o-transcribe-diarize`. Body: `file`, `model`, `language`, `prompt`
(≤224 tokens), `response_format`, `timestamp_granularities` (**whisper-1 only**),
`stream`, `chunking_strategy`. **25 MB file cap.**
`stream: true` emits `transcript.text.delta` → `transcript.text.done`
(not supported on `whisper-1`).

**Realtime STT:**
```jsonc
{ "type": "session.update", "session": {
    "type": "transcription",
    "audio": { "input": {
      "format": { "type": "audio/pcm", "rate": 24000 },
      "transcription": { "model": "gpt-realtime-whisper", "language": "en" }
    } } } }
{ "type": "input_audio_buffer.append", "audio": "<base64 pcm16>" }
{ "type": "input_audio_buffer.commit" }
// server →
{ "type": "conversation.item.input_audio_transcription.delta", "item_id": "...", "delta": "Hello," }
{ "type": "conversation.item.input_audio_transcription.completed", "item_id": "...", "transcript": "Hello, how are you?" }
```

**Quirks:** `response_format` is a bare name, so sample rate is **not
selectable** — PCM is always 24 kHz. Deltas are **incremental**, unlike
AssemblyAI's cumulative turn transcript. `timestamp_granularities` silently
only works on the oldest model.

---

### 2.5 AssemblyAI

**Auth:** `Authorization: <key>` — **no `Bearer` prefix**. Browser path:
temporary token.
**Base:** `https://api.assemblyai.com` (EU: `api.eu.assemblyai.com`) /
`wss://streaming.assemblyai.com`

| Capability    | Endpoint                             |
| ------------- | ------------------------------------ |
| `tts`         | ❌ not offered                        |
| `stt`         | `POST /v2/transcript` — **async job** |
| `realtimeTTS` | ❌                                    |
| `realtimeSTT` | `WSS /v3/ws`                          |

**Batch STT is the outlier:** it does not accept raw bytes and does not return a
transcript synchronously.
1. `POST /v2/upload` with the bytes → get a URL (or supply your own `audio_url`)
2. `POST /v2/transcript` with `audio_url`, `speech_models`
   (default `["universal-3-5-pro","universal-2"]`), `language_code`,
   `speaker_labels`, `punctuate`, `format_text` → get `{ id, status: "queued" }`
3. Poll `GET /v2/transcript/{id}` until `status` is `completed` or `error`
   (or use `webhook_url`)

Response `words[]`: `{ text, start, end, confidence, speaker }` — **timings in
milliseconds**, unlike everyone else's seconds.

**Realtime STT:**
```jsonc
// client → binary audio frames
// server →
{ "type": "Begin", "id": "...", "expires_at": ... }
{ "type": "Turn", "turn_order": 0, "end_of_turn": true, "turn_is_formatted": true,
  "end_of_turn_confidence": 1.0, "transcript": "...",
  "words": [{ "text", "start", "end", "confidence", "word_is_final" }] }
{ "type": "Termination", "audio_duration_seconds": 10, "session_duration_seconds": 12 }
```
Query params: `speech_model` (`universal-3-5-pro`), `encoding` (`aac` |
`ogg_opus` | `opus`; default 16-bit PCM mono), `sample_rate`, `format_turns`,
`end_of_turn_confidence_threshold`.

**Quirks:** the **turn model is fundamentally different** — `transcript` is the
*cumulative text of the current turn*, re-sent and revised on every event, not a
delta. Timings in ms. Batch requires a two-step upload the provider must hide.

---

### 2.6 Groq

**Auth:** `Authorization: Bearer <key>`. OpenAI-compatible surface.
**Base:** `https://api.groq.com/openai/v1`

| Capability    | Endpoint                       |
| ------------- | ------------------------------ |
| `tts`         | `POST /audio/speech`           |
| `stt`         | `POST /audio/transcriptions`   |
| `realtimeTTS` | ❌                             |
| `realtimeSTT` | ❌                             |

**STT:** `whisper-large-v3-turbo`, `whisper-large-v3`. Fields: `file` or `url`,
`model`, `language`, `response_format` (`json` | `verbose_json` | `text`),
`timestamp_granularities` (needs `verbose_json`), `prompt` (≤224 tokens),
`temperature`. Limits: 25 MB free / 100 MB dev tier; audio downsampled to
16 kHz mono; 10s minimum billing.

**TTS:** `canopylabs/orpheus-v1-english`, `canopylabs/orpheus-arabic-saudi`.
Fields: `model`, `input`, `voice` (e.g. `troy`, `hannah`, `austin`),
`response_format` (default `wav`).

**Quirks:** the **only provider with zero realtime support** — the useful proof
that the capability guard actually earns its keep. OpenAI-compatible enough that
the OpenAI provider can likely be parameterized rather than duplicated.

---

## 3. Cross-provider normalization problems

These are the real design constraints. Each one is a place where a naive
abstraction leaks.

### 3.1 Realtime STT finality is not a boolean

| Provider   | Finality model                                                      |
| ---------- | ------------------------------------------------------------------- |
| Deepgram   | `is_final` (segment stable) + `speech_final` (endpoint) — 2 levels    |
| DG Flux    | `StartOfTurn` → `Update` → `EagerEndOfTurn` ⇄ `TurnResumed` → `EndOfTurn` |
| ElevenLabs | `partial` → `final` → `committed` — 3 levels                          |
| AssemblyAI | `end_of_turn` + `turn_is_formatted` — turn-scoped                     |
| Cartesia   | `is_final`, but **only after an explicit `finalize`** on ink-whisper   |
| OpenAI     | `delta` → `completed`                                                 |

The current core's `isFinal: boolean` is lossy. **Proposal:** a three-state
discriminator that every provider can map onto without inventing information:

```ts
type Finality =
  | "partial"    // interim hypothesis, will be revised
  | "final"      // this segment is stable and won't change
  | "turn_end";  // the speaker finished a turn / endpoint detected
```

Mapping: Deepgram `is_final`→`final`, `speech_final`→`turn_end`. ElevenLabs
`partial`→`partial`, `final`→`final`, `committed`→`turn_end`. AssemblyAI
`end_of_turn:false`→`partial`, `true`→`turn_end`. OpenAI `delta`→`partial`,
`completed`→`turn_end`. Cartesia `is_final:false`→`partial`, `true`→`final`.

### 3.2 Delta vs cumulative text

OpenAI emits **incremental deltas** (`"Hello,"` then `" how"`). AssemblyAI
emits the **cumulative turn transcript** every time. Deepgram emits **per-segment**
text. Cartesia emits deltas.

**Proposal:** normalize to *both*, computed by the core so providers stay dumb —
`text` is always the cumulative text of the current turn; `delta` is always just
the new part. Providers that give one get the other derived.

### 3.3 Audio format vocabulary

- ElevenLabs: one opaque string, `mp3_44100_128`
- Deepgram / Cartesia: decomposed `encoding` + `sample_rate` (+ `container`)
- OpenAI / Groq: a bare name (`mp3`, `pcm`) — **sample rate not selectable**

The existing `OutputFormat { container, sampleRate, bitrate }` is missing
`encoding`, which matters enormously for realtime (`pcm_s16le` vs `pcm_f32le`
vs `mulaw` are not interchangeable when feeding a speaker or a phone line).

**Proposal:** `{ container, encoding, sampleRate, bitrate }`, all optional, with
each provider lowering it to its own vocabulary and **throwing a clear error on
an unrepresentable combination** rather than silently substituting.

### 3.4 Realtime input format is required, not optional

Deepgram, Cartesia, and ElevenLabs all need encoding + sample rate as
*connection-time* query params. There is no negotiation and no sniffing. So
`RealtimeSTTInput.inputFormat` should be effectively required (or defaulted to
PCM s16le 16 kHz, the common denominator) — it cannot be an afterthought.

### 3.5 Transport and liveness differ

- Deepgram: **mandatory `KeepAlive` every ~10s**
- ElevenLabs: `inactivity_timeout` query param
- ElevenLabs realtime: **base64 JSON in both directions**
- Deepgram / Cartesia / AssemblyAI: **binary frames** for audio
- Cartesia: control messages are **bare strings** (`finalize`, `close`)

The session layer needs a per-provider heartbeat hook and must not assume
binary frames.

### 3.6 Barge-in / cancel is not universal

Deepgram `Clear` and Cartesia `cancel` genuinely discard queued audio.
ElevenLabs has no true cancel — you close the socket. A `cancel()` on the
session contract must document that it is best-effort, or expose whether it is
supported.

### 3.7 Batch STT input shape

Most take raw bytes (multipart). AssemblyAI takes **only a URL**, requiring an
upload round-trip first. OpenAI/Groq cap at **25 MB**. ElevenLabs allows 5 GB.
The provider must hide the upload; the core should surface size limits as a
typed error, not a raw 413.

### 3.8 Auth header shapes

| Provider   | Header                              |
| ---------- | ----------------------------------- |
| ElevenLabs | `xi-api-key: <key>`                 |
| Deepgram   | `Authorization: Token <key>`        |
| OpenAI     | `Authorization: Bearer <key>`       |
| Groq       | `Authorization: Bearer <key>`       |
| Cartesia   | `Authorization: Bearer <key>` + `Cartesia-Version` |
| AssemblyAI | `Authorization: <key>` (no prefix)  |

All six additionally offer an ephemeral/temporary token flow for browser use —
worth a shared `getEphemeralToken()` shape later, but out of scope for v0.

---

## 4. Proposed core shape

> Superseded in detail by [type-design.md](./type-design.md) +
> [core-types.draft.ts](./core-types.draft.ts). The sketch below is the shape
> those were built out from.

Capability checking is **runtime-guarded** (per decision): every method exists
on the facade, unsupported ones throw `CapabilityError`.

```ts
export type Capability = "tts" | "stt" | "realtimeTTS" | "realtimeSTT";

export interface Capabilities {
  tts: boolean;
  stt: boolean;
  realtimeTTS: boolean;
  realtimeSTT: boolean;
}

export interface VoiceProvider {
  readonly name: string;
  readonly capabilities: Readonly<Capabilities>;

  /** `tts` */
  speak?(input: SpeakInput, signal?: AbortSignal): Promise<SpeakResult>;
  speakStream?(input: SpeakInput, signal?: AbortSignal): AsyncIterable<AudioChunk>;

  /** `stt` */
  transcribe?(input: TranscribeInput, signal?: AbortSignal): Promise<Transcript>;

  /** `realtimeTTS` / `realtimeSTT` */
  openTTSSession?(input: RealtimeTTSInput): Promise<TTSSession>;
  openSTTSession?(input: RealtimeSTTInput): Promise<STTSession>;

  listVoices?(): Promise<VoiceInfo[]>;
  close?(): Promise<void>;
}
```

The invariant to enforce (a runtime assert at construction, and a doc rule):
**if a capability flag is `true`, the corresponding method(s) must be present.**

Session contract, shared by both directions:

```ts
export interface Session<In, Out> {
  push(input: In): void;
  flush(): Promise<void>;
  cancel(): void;          // best-effort; see 3.6
  end(): Promise<void>;
  readonly output: AsyncIterable<Out>;
}

export type TTSSession = Session<string, AudioChunk>;
export type STTSession = Session<Uint8Array, TranscriptEvent>;
```

---

## 5. Open decisions

1. **Runtime target.** Node-first vs isomorphic. Recommendation: keep core
   platform-neutral (`fetch`, `Uint8Array`, Web Streams, injectable WebSocket
   factory), ship Node first, add browser as an additive entry point. The
   ephemeral-token flows in §3.8 exist precisely for browser use, so the door
   should stay open.
2. **`flush()`/`end()` sync or async.** The current `StreamSession` has them
   returning `void`. Deepgram acks `Flush` with `Flushed`, Cartesia with
   `flush_done` — so a `Promise` is meaningful and worth having.
3. **Should `speakStream` be its own capability flag?** It is currently folded
   into `tts`. Every TTS provider supports it, so a flag would always be `true`
   — folding it in is right, but the docs must be explicit (see §1 warning).
4. **Groq/OpenAI sharing.** Groq is OpenAI-compatible; consider one
   parameterized implementation rather than two.
