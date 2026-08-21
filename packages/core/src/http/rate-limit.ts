import type { HttpMiddleware } from "./types";

export interface RateLimitOptions {
    /** Requests allowed in flight at once. */
    concurrency?: number;
    /** Minimum milliseconds between two request starts. */
    minInterval?: number;
}

/**
 * Gates how fast requests leave.
 *
 * State is per-middleware-instance, so one provider's limiter never throttles
 * another's.
 */
export function rateLimit(options: RateLimitOptions = {}): HttpMiddleware {
    const concurrency = options.concurrency ?? Number.POSITIVE_INFINITY;
    const minInterval = options.minInterval ?? 0;

    let active = 0;
    let lastStart = 0;
    const waiting: (() => void)[] = [];

    function release(): void {
        active -= 1;
        waiting.shift()?.();
    }

    async function acquire(signal: AbortSignal | undefined): Promise<void> {
        if (active >= concurrency) {
            await new Promise<void>((resolve, reject) => {
                const admit = () => {
                    signal?.removeEventListener("abort", onAbort);
                    resolve();
                };
                const onAbort = () => {
                    const index = waiting.indexOf(admit);
                    if (index >= 0) waiting.splice(index, 1);
                    reject(signal?.reason);
                };

                if (signal?.aborted) {
                    reject(signal.reason);
                    return;
                }
                waiting.push(admit);
                signal?.addEventListener("abort", onAbort, { once: true });
            });
        }

        active += 1;

        const wait = lastStart + minInterval - Date.now();
        if (minInterval > 0 && wait > 0) {
            // Claim the slot before sleeping, so concurrent callers space out
            // against each other rather than all measuring from the same start.
            lastStart += minInterval;
            await sleep(wait, signal).catch((error) => {
                release();
                throw error;
            });
        } else {
            lastStart = Date.now();
        }
    }

    return (next) => async (request) => {
        await acquire(request.signal);
        try {
            return await next(request);
        } finally {
            release();
        }
    };
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
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
