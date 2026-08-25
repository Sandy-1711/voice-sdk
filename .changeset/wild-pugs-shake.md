---
"@swungstudent/voice": major
"@swungstudent/cartesia": major
"@swungstudent/deepgram": major
"@swungstudent/elevenlabs": major
---

Make session cancellation work, and drop the client-level close that never did.

`RealtimeTTSInput.signal` and `RealtimeSTTInput.signal` have always been part of
the public input types, and only Deepgram honoured them — Cartesia and
ElevenLabs accepted the option and ignored it, so a caller aborting a call was
left with open sockets. All three now close their sessions on abort, and refuse
to open at all on a signal that has already aborted, the way `fetch` does.

`session.close()` no longer waits indefinitely. Providers whose goodbye is an
application message waited on the server to hang up, so one that never did left
`close()` pending forever; it now gives up after five seconds and drops the
socket.

**Breaking:** `Voice.close()` and the optional `close()` on `VoiceProvider` are
removed. Nothing changes at runtime — no provider implemented it, so the call
was a no-op everywhere it was made — but code that calls it will no longer
typecheck. Close sessions individually, or give them a shared `AbortController`
and abort it:

```ts
const call = new AbortController();
const listening = await voice.openSTTSession({ signal: call.signal });
const speaking = await voice.openTTSSession({ signal: call.signal });

call.abort();
```
