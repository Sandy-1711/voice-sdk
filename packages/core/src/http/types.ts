/**
 * Travels with the request but never reaches the wire. Middleware reads it to
 * decide what to do; providers write it so the decision has something to go on.
 */
export interface RequestMeta {
    /** Provider name, for logs and metrics. */
    provider: string;
    /** The core operation behind this request, e.g. "speak". */
    operation: string;
    /** 0 on the first try. `retry` increments it before each further attempt. */
    attempt: number;
    /**
     * The body is consumed incrementally, so no deadline may outlive the
     * headers and nothing may buffer the response.
     */
    stream?: boolean;
    /** Per-call override from `RequestContext`, and it wins over any default. */
    retries?: number;
    /** Per-call override from `RequestContext`, in milliseconds. */
    timeout?: number;
}

export interface HttpRequest {
    url: URL;
    method: string;
    headers: Record<string, string>;
    body?: BodyInit;
    /** The caller's signal. Whole-operation budget, body included. */
    signal?: AbortSignal;
    meta: RequestMeta;
}

export type HttpHandler = (request: HttpRequest) => Promise<Response>;

/**
 * Wraps a handler in another handler. The classic onion: whatever a middleware
 * does before calling `next` happens on the way down, whatever it does after
 * happens on the way back up.
 */
export type HttpMiddleware = (next: HttpHandler) => HttpHandler;
