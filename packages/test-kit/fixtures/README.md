# Live-tier fixtures

## `spoken-16k.pcm`

Headerless PCM, signed 16-bit little-endian, mono, 16 kHz — 3.76 seconds. Read
it with `spokenSample()`; wrap it with `wav()` for endpoints that want a
container.

It says:

> Hello there. I would like to book a table for two people tomorrow evening.

Synthesized with Cartesia `sonic-3.5`. Every live STT test transcribes this one
clip, so replacing it means re-checking the `"book a table"` assertions — but it
is a single file behind a single accessor, so a swap is contained.

If the provider terms covering synthesized output ever make redistributing this
awkward, replace it with a public-domain recording of the same sentence. Nothing
else has to change.
