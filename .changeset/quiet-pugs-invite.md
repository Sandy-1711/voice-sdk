---
"@swungstudent/voice": patch
"@swungstudent/deepgram": patch
"@swungstudent/elevenlabs": patch
---

Fix a rate-limited request ignoring an already-aborted signal. `rateLimit`
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
