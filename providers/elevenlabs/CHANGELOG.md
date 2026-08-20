# @swungstudent/elevenlabs

## 0.2.0

### Minor Changes

- 0dcc646: Add two middleware layers, and drop the ElevenLabs SDK.

  **Core** gains an HTTP transport with a composable middleware chain — `retry`,
  `timeout`, `logging` and `rateLimit`, assembled by `createTransport` — plus
  operation-level `VoiceMiddleware` hooks on the `Voice` wrapper for logging,
  metrics and tracing. `VoiceOptions.logger` now does something: supplying one
  installs the built-in operation logger, which reports the model, voice and
  character count behind each call.

  **Providers** take `retries`, `timeout`, `logger`, `rateLimit`, `middleware` and
  `fetch` options. A per-call `RequestContext` still wins over the provider
  default, as before.

  **`@swungstudent/elevenlabs` no longer depends on `@elevenlabs/elevenlabs-js`**,
  which was 19,963 files and 22.4 MB unpacked to reach six endpoints — enough to
  make installs crawl or fail outright. The package now depends on `ws` alone.
  The public surface is unchanged, and `providerOptions` keep working in
  camelCase (and now in snake_case too), but two things are worth knowing:
  - Failures now throw `VoiceError` with a formatted message rather than the
    SDK's own error classes.
  - `raw` carries the camelised wire response rather than the SDK's model object.

  Retry now covers thrown network errors, and honours `Retry-After` and
  `X-RateLimit-Reset` — neither of which the previous clients did.

### Patch Changes

- Updated dependencies [0dcc646]
  - @swungstudent/voice@0.2.0

## 0.1.1

### Patch Changes

- 764655b: Fix three failures that made whole capabilities unusable.
  - **Cartesia**: every REST call — `speak`, `speakStream` and `transcribe` —
    failed with `timeout must be an integer` unless the caller happened to pass a
    numeric timeout. The client validates the deadline on key presence rather than
    value, and an unset one was being sent as an explicit `undefined`.
  - **Cartesia**: a failing realtime STT session reported nothing at all. The SDK
    funnels API and socket failures into the stream's own error event rather than
    yielding them as messages, so the session dropped them and callers waited for
    transcripts that were never coming.
  - **ElevenLabs**: `session.close()` never returned when called while the socket
    was still connecting — an error path or an early unmount would hang.

- @swungstudent/voice@0.1.1
