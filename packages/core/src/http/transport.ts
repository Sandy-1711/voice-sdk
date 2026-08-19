import type { Logger } from "../logger";
import { compose, fetchHandler } from "./compose";
import { logging } from "./logging";
import { rateLimit, type RateLimitOptions } from "./rate-limit";
import { retry } from "./retry";
import { timeout } from "./timeout";
import type { HttpHandler, HttpMiddleware } from "./types";

export interface TransportOptions {
    /** Named in logs and in timeout messages. */
    provider: string;
    /** Extra attempts after the first. Per-call `RequestContext.retries` wins. */
    retries?: number;
    /** Milliseconds to first byte. Per-call `RequestContext.timeout` wins. */
    timeout?: number;
    /** Supplying one is what turns request logging on. */
    logger?: Logger;
    /** Supplying one is what turns rate limiting on. */
    rateLimit?: RateLimitOptions;
    /** Caller middleware, applied outside the built-in chain. */
    middleware?: HttpMiddleware[];
    /** Innermost handler. Swappable so a test never has to reach the network. */
    fetch?: HttpHandler;
}

/**
 * Assembles the default chain:
 *
 *     caller middleware → logging → retry → rateLimit → timeout → fetch
 *
 * Every position earns its place. `logging` is outermost so one line covers a
 * whole logical request, retries included. `retry` sits outside `rateLimit` so
 * a request that is backing off is not holding a concurrency slot while it
 * sleeps. `rateLimit` sits outside `timeout` so each attempt takes its own slot
 * and gets its own fresh deadline.
 */
export function createTransport(options: TransportOptions): HttpHandler {
    const chain: HttpMiddleware[] = [...(options.middleware ?? [])];

    if (options.logger) chain.push(logging({ logger: options.logger }));
    chain.push(retry({ retries: options.retries, logger: options.logger }));
    if (options.rateLimit) chain.push(rateLimit(options.rateLimit));
    chain.push(timeout({ ms: options.timeout }));

    return compose(chain)(options.fetch ?? fetchHandler);
}
