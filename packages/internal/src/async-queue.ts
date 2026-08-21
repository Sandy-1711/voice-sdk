/**
 * Bridges a push-based socket into the pull-based AsyncIterable that sessions
 * expose. Values pushed before anyone iterates are buffered, not dropped.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
    #items: T[] = [];
    #wake: (() => void) | null = null;
    #closed = false;
    #error: unknown;

    push(item: T): void {
        if (this.#closed) return;
        this.#items.push(item);
        this.#signal();
    }

    close(): void {
        this.#closed = true;
        this.#signal();
    }

    fail(error: unknown): void {
        if (this.#closed) return;
        this.#error = error;
        this.#closed = true;
        this.#signal();
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        for (;;) {
            while (this.#items.length > 0) yield this.#items.shift() as T;
            if (this.#error) {
                // Re-widened: the truthiness check above narrows #error to {},
                // and rethrowing what fail() was handed is the whole point.
                const error: unknown = this.#error;
                throw error;
            }
            if (this.#closed) return;
            await new Promise<void>((resolve) => {
                this.#wake = resolve;
            });
        }
    }

    #signal(): void {
        const wake = this.#wake;
        this.#wake = null;
        wake?.();
    }
}
