# @swungstudent/deepgram

## 0.2.1

### Patch Changes

- 2b5c9d0: Fix a rate-limited request ignoring an already-aborted signal. `rateLimit`
  checked `signal.aborted` only when it had to queue behind the concurrency cap,
  so an uncontended request carrying an aborted signal fell through to the
  `minInterval` wait. That wait never observes an abort that already happened, so
  it ran to completion and the request went out as though it had not been
  cancelled. Configurations without `rateLimit` are unaffected.
  
  Fix realtime sessions mis-reading socket frames. Frames were decoded with
  `raw.toString()`, which returns `"[object ArrayBuffer]"` for the ArrayBuffer
  shape `ws` is typed to deliver — surfacing as "sent invalid JSON" rather than
  the message that actually arrived.
  
  `speakStream` failures now reach the configured logger. A provider that threw
  while opening a stream was previously logged as neither success nor failure.
  
  Fix Cartesia realtime sessions on Node 18 and 20, where they threw "requires
  the `ws` package but it could not be loaded". `@cartesia/cartesia-js` calls
  `require('ws')` from its ESM build, where `require` does not exist, and then
  falls back to a global `WebSocket` that only Node 22 and later provide.
  Cartesia now supplies that global from the `ws` it already depends on.
- Updated dependencies [2b5c9d0]
  - @swungstudent/voice@0.2.1

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

- @swungstudent/voice@0.1.1
