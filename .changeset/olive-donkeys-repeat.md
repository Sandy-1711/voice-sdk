---
"@swungstudent/cartesia": minor
"@swungstudent/voice": patch
---

Drop the Cartesia SDK, and put the provider on core's HTTP transport.

**`@swungstudent/cartesia` no longer depends on `@cartesia/cartesia-js`.** `ws`
is the only runtime dependency left. The public surface is unchanged and every
endpoint is the same, but three things are worth knowing:

- Failures now throw `VoiceError` with a formatted message
  (`Cartesia request failed (422): …`) rather than the SDK's own error classes.
  Cartesia had no error normaliser before, so a bare 400 hid which parameter it
  objected to.
- `raw` carries the wire response rather than the SDK's model object.
- `openTTSSession` and `openSTTSession` now wait for the socket handshake, so a
  bad key, a bad model or an unreachable host rejects from the call instead of
  resolving and then ending the caller's `for await` with nothing. Deepgram
  already behaved this way.

**`CartesiaProvider` takes `retries`, `timeout`, `logger`, `rateLimit`,
`middleware` and `fetch`,** like the other two providers. Cartesia previously
had none of them: no retry, no backoff, no deadline, no rate limiting and no
request logging. Retry now covers thrown network errors and honours
`Retry-After` and `X-RateLimit-Reset`, none of which the SDK did.

**`defaultRealtimeSTTModel` is new.** Cartesia picks its realtime STT model by
turn-detection mode, and there was previously no way to override either default.

**Two SDK bugs stop needing workarounds.** Realtime sessions on Node 18 and 20
no longer depend on a global `WebSocket` being present, and a dropped STT socket
can no longer take a caller's process down with an unhandled rejection. Realtime
is now covered on Node 18 by a smoke test that runs the built package, since the
unit suite cannot: vitest does not run there, so nothing else would notice a
runtime global that Node 18 lacks.

**Realtime synthesis now protects the mapped output format.** Passing
`output_format` through `providerOptions` no longer overrides the format derived
from `format`, matching `speak`. `session.format` is a promise about how to play
the bytes, and it could previously be made false without the caller knowing.
Every other `providerOptions` key merges as before.
