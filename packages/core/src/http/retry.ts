import type { Logger } from "../logger";
import type { HttpMiddleware, HttpRequest } from "./types";

export interface RetryOptions {
    /** Extra attempts after the first. A per-call `RequestContext.retries` wins. */
    retries?: number;
    /** Replaces the default status check rather than adding to it. */
    isRetryable?: (response: Response) => boolean;
    /** First backoff step in milliseconds; doubles from there. */
    baseDelay?: number;
    /** Ceiling for any single wait, in milliseconds. */
    maxDelay?: number;
    logger?: Logger;
}

const DEFAULT_RETRIES = 2;
const BASE_DELAY = 1000;
const MAX_DELAY = 60_000;

/** 408 and 429 are explicit invitations to try again; 5xx is the server's fault. */
function retryableStatus(response: Response): boolean {
    return response.status === 408 || response.status === 429 || response.status >= 500;
}

/**
 * Retries transient failures, including thrown network errors — which the
 * generated provider SDKs never did, since they only ever inspected a status
 * code they had already received.
 *
 * A non-retryable failure is returned, not thrown. Only the provider knows the
 * shape of its own error envelope, so turning a 400 into a `VoiceError` stays
 * there.
 */
export function retry(options: RetryOptions = {}): HttpMiddleware {
    const isRetryable = options.isRetryable ?? retryableStatus;
    const baseDelay = options.baseDelay ?? BASE_DELAY;
    const maxDelay = options.maxDelay ?? MAX_DELAY;

    return (next) => async (request) => {
        const retries = request.meta.retries ?? options.retries ?? DEFAULT_RETRIES;
        // A stream body is consumed by the first attempt and cannot be rewound.
        const replayable = !(request.body instanceof ReadableStream);
        const attempts = retries > 0 && replayable ? retries + 1 : 1;

        let lastError: unknown;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const last = attempt === attempts - 1;
            const tried: HttpRequest = { ...request, meta: { ...request.meta, attempt } };

            try {
                const response = await next(tried);
                if (last || !isRetryable(response)) return response;

                options.logger?.debug(
                    `${request.meta.provider}.${request.meta.operation} attempt ${attempt + 1}/${attempts} got ${response.status}, retrying`,
                );
                // Nothing will read it, and an unread body holds the socket.
                await response.body?.cancel().catch(() => {});
                await sleep(delayFor(response, attempt, baseDelay, maxDelay), request.signal);
            } catch (error) {
                // The caller's own abort is an answer, not a failure to retry.
                if (request.signal?.aborted) throw error;
                if (last) throw error;

                lastError = error;
                options.logger?.debug(
                    `${request.meta.provider}.${request.meta.operation} attempt ${attempt + 1}/${attempts} failed: ${String(error)}, retrying`,
                );
                await sleep(backoff(attempt, baseDelay, maxDelay), request.signal);
            }
        }

        // Only reachable if the loop body stopped short of returning or throwing.
        throw lastError;
    };
}

/**
 * The server's own instruction beats our guess. `Retry-After` is either a count
 * of seconds or an HTTP-date; `X-RateLimit-Reset` is an epoch timestamp.
 */
function delayFor(response: Response, attempt: number, base: number, max: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
        const seconds = Number.parseInt(retryAfter, 10);
        if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, max);

        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) {
            const delay = date - Date.now();
            if (delay > 0) return Math.min(delay, max);
        }
    }

    const reset = response.headers.get("x-ratelimit-reset");
    if (reset) {
        const epoch = Number.parseInt(reset, 10);
        if (Number.isFinite(epoch)) {
            const delay = epoch * 1000 - Date.now();
            if (delay > 0) return Math.min(delay, max);
        }
    }

    return backoff(attempt, base, max);
}

/** Full jitter, so a fleet that fails together does not retry together. */
function backoff(attempt: number, base: number, max: number): number {
    return Math.min(base * 2 ** attempt, max) * (0.5 + Math.random() / 2);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
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
