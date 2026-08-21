---
"@swungstudent/voice": patch
"@swungstudent/cartesia": patch
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

Fix Cartesia realtime sessions on Node 18 and 20, where they threw "requires
the `ws` package but it could not be loaded". `@cartesia/cartesia-js` calls
`require('ws')` from its ESM build, where `require` does not exist, and then
falls back to a global `WebSocket` that only Node 22 and later provide.
Cartesia now supplies that global from the `ws` it already depends on.
