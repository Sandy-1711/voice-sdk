---
"@swungstudent/cartesia": patch
---

Cartesia `transcribe()` now returns word timestamps when asked for them.

Repeated multipart fields were sent as a bare repeated key, but Cartesia's
batch transcription endpoint follows OpenAI's convention and expects a `[]`
suffix. It accepted `timestamp_granularities` and ignored it, so
`timestamps: "word"` came back with a correct transcript and `words`
undefined — no error, just missing data.

Anything passed to this endpoint as an array through `providerOptions` is now
sent with the same suffix.
