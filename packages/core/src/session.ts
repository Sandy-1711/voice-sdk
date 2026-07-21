export interface StreamSession<In, Out> {
  /** Feed input incrementally — text tokens (TTS) or audio frames (STT). Fire-and-forget. */
  push(input: In): void;

  /** Commit buffered input *now* — synthesize/finalize what's been pushed so far.
   *  The session stays open for more input. */
  flush(): void;

  /** Interrupt in-flight output immediately (barge-in / execution control).
   *  Discards pending output; the session stays open and reusable. */
  cancel(): void;

  /** No more input. Flushes what remains, lets output finish, then closes. */
  end(): void;

  /** The output stream. Completes when the session ends; rejects here on error. */
  readonly output: AsyncIterable<Out>;
}
