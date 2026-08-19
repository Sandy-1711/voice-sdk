import type { HttpHandler, HttpMiddleware, HttpRequest } from "./types";

/**
 * Folds a list into one middleware. The first entry ends up outermost, so it
 * sees the request first and the response last — reading order matches the
 * order bytes travel.
 */
export function compose(middleware: HttpMiddleware[]): HttpMiddleware {
    return (next) => middleware.reduceRight((handler, wrap) => wrap(handler), next);
}

/** The innermost handler: the one that actually goes to the network. */
export const fetchHandler: HttpHandler = (request: HttpRequest) =>
    fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal,
    });
