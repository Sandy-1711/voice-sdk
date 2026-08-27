---
"@swungstudent/elevenlabs": patch
---

Surface errors sent over the realtime TTS socket instead of ending the stream
silently.

ElevenLabs reports a fatal problem as its own frame — `{ error, message, code }`
— and then closes. That frame had no branch in the session's message handler, so
it was parsed, matched nothing, and discarded; the close then ended the stream
normally. A caller got no audio, no error, and nothing saying why.

Asking for a library voice on a free plan is the easiest way to hit this: the
socket opens, the 402 arrives as an ignored frame, and `output` completes empty.
It now fails with the provider's own message.
