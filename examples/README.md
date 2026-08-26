# Examples

Small, single-purpose programs against the real API — the kind of thing to copy
as a starting point. They import the published package names, so the code reads
exactly as it would in your own project.

They are typechecked in CI (`pnpm check-types`), so an example that stops
compiling fails the build rather than sitting there wrong.

## Running them

Each needs a real key and costs real money. Install once at the repo root, then
run from `examples/basics`:

```sh
pnpm install
cd examples/basics
DEEPGRAM_API_KEY=… pnpm tsx src/speak-to-file.ts
```

| Example                                             | What it shows                                           | Needs                                         |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| [`speak-to-file.ts`](basics/src/speak-to-file.ts)   | one-shot `speak`, written to a wav                      | `DEEPGRAM_API_KEY`                            |
| [`speak-stream.ts`](basics/src/speak-stream.ts)     | `speakStream`, written as chunks arrive                 | `DEEPGRAM_API_KEY`                            |
| [`transcribe.ts`](basics/src/transcribe.ts)         | batch `transcribe` with timestamps and diarization      | `DEEPGRAM_API_KEY`                            |
| [`realtime-stt.ts`](basics/src/realtime-stt.ts)     | a live session fed at real-time pacing, printing turns  | `DEEPGRAM_API_KEY`                            |
| [`realtime-tts.ts`](basics/src/realtime-tts.ts)     | a session driven by pushed text, the LLM-response shape | `DEEPGRAM_API_KEY`                            |
| [`swap-providers.ts`](basics/src/swap-providers.ts) | the same calls on any of the three providers            | `PROVIDER` plus that provider's key and voice |

Run `speak-to-file.ts` before `transcribe.ts` — the second reads the wav the
first writes. Everything lands in `examples/basics/out/`, which is ignored.

Audio written as `.raw` is headerless PCM. To hear it:

```sh
ffplay -f s16le -ar 24000 -ch_layout mono out/stream.raw
```
