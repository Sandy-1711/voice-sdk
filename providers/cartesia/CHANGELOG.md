# @swungstudent/cartesia

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
