/**
 * A cancellable delay.
 *
 * The `aborted` pre-check is load-bearing: `addEventListener("abort")` never
 * fires for a signal that is already aborted, so without it an aborted caller
 * would wait out the full delay and then resolve as though nothing happened.
 */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
