import type { HttpMiddleware } from "./types";

export interface TimeoutOptions {
    /**
     * Milliseconds allowed for the response headers to arrive. A per-call
     * `RequestContext.timeout` overrides it.
     */
    ms?: number;
}

/**
 * Bounds time-to-headers, not time-to-last-byte.
 *
 * Once the status line lands the timer is cleared and the body streams with no
 * deadline. That is the only workable rule when `speakStream` holds a response
 * open for as long as the audio takes to generate — a deadline that outlived
 * the headers would abort it mid-body. For a budget over the whole operation,
 * pass an `AbortSignal`: it travels untouched through every layer.
 *
 * Sits innermost by default, so each retry attempt gets its own fresh deadline.
 */
export function timeout(options: TimeoutOptions = {}): HttpMiddleware {
    return (next) => async (request) => {
        const ms = request.meta.timeout ?? options.ms;
        if (ms === undefined) return next(request);

        const outer = request.signal;
        const controller = new AbortController();
        const timer = setTimeout(
            () =>
                controller.abort(
                    new Error(`${request.meta.provider} ${request.meta.operation} timed out after ${ms}ms`),
                ),
            ms,
        );
        const forward = () => controller.abort(outer?.reason);

        if (outer?.aborted) forward();
        else outer?.addEventListener("abort", forward, { once: true });

        const detach = () => outer?.removeEventListener("abort", forward);

        try {
            const response = await next({ ...request, signal: controller.signal });

            // fetch saw `controller.signal`, not the caller's, so unhooking
            // `forward` here would strand an in-flight body: a later abort
            // would have nothing left to cancel. Streaming responses keep the
            // link for their lifetime — that is what makes barge-in work.
            // Buffered ones are read immediately, so they let go now.
            if (!request.meta.stream) detach();
            return response;
        } catch (error) {
            detach();
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };
}
