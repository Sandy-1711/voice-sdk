/**
 * A single-consumer async queue that bridges push-based events (e.g. WebSocket
 * messages) to a pull-based `AsyncIterable`. Values pushed while no consumer is
 * waiting are buffered; a waiting consumer is resolved immediately.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  #values: T[] = [];
  #resolvers: Array<(result: IteratorResult<T>) => void> = [];
  #done = false;
  #error: unknown = undefined;

  /** Enqueue a value (no-op once closed/failed). */
  push(value: T): void {
    if (this.#done) return;
    const resolve = this.#resolvers.shift();
    if (resolve) resolve({ value, done: false });
    else this.#values.push(value);
  }

  /** Signal end-of-stream. Buffered values are still drained first. */
  close(): void {
    if (this.#done) return;
    this.#done = true;
    let resolve: ((result: IteratorResult<T>) => void) | undefined;
    while ((resolve = this.#resolvers.shift())) {
      resolve({ value: undefined, done: true });
    }
  }

  /** End the stream with an error, surfaced to the consumer on next pull. */
  fail(error: unknown): void {
    if (this.#done) return;
    this.#error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.#values.length > 0) {
        yield this.#values.shift() as T;
        continue;
      }
      if (this.#done) {
        if (this.#error) throw this.#error;
        return;
      }
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.#resolvers.push(resolve);
      });
      if (result.done) {
        if (this.#error) throw this.#error;
        return;
      }
      yield result.value;
    }
  }
}
