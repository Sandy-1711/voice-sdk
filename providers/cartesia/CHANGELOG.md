# @swungstudent/cartesia

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
