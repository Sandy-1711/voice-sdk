import type { Logger } from "../logger";
import type { HttpMiddleware } from "./types";

export interface LoggingOptions {
    logger: Logger;
    /** Log the outgoing request too, not just its outcome. */
    verbose?: boolean;
}

/** Anything that smells like a credential is replaced before the URL is logged. */
const SECRET = /key|token|secret|auth|password|sig/i;

/**
 * Sits outermost, so one line covers the whole logical request — retries
 * included — and the duration is the wall time the caller actually waited.
 *
 * Headers are never logged: that is where every provider we ship puts its API
 * key.
 */
export function logging({ logger, verbose }: LoggingOptions): HttpMiddleware {
    return (next) => async (request) => {
        const label = `${request.meta.provider}.${request.meta.operation}`;
        const target = `${request.method} ${redact(request.url)}`;
        const started = Date.now();

        if (verbose) logger.debug(`${label} → ${target}`);

        try {
            const response = await next(request);
            const took = Date.now() - started;

            if (response.ok) logger.debug(`${label} ← ${response.status} in ${took}ms`);
            else logger.warn(`${label} ← ${response.status} in ${took}ms (${target})`);

            return response;
        } catch (error) {
            logger.error(`${label} ✗ after ${Date.now() - started}ms (${target}): ${String(error)}`);
            throw error;
        }
    };
}

export function redact(url: URL): string {
    const safe = new URL(url);
    for (const name of [...safe.searchParams.keys()]) {
        if (SECRET.test(name)) safe.searchParams.set(name, "***");
    }
    return safe.toString();
}
