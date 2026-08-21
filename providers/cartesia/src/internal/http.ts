import { VoiceError } from "@swungstudent/voice";
import type { HttpHandler, RequestContext } from "@swungstudent/voice";
import { CARTESIA_VERSION, DEFAULT_BASE_URL, PROVIDER } from "../config";

export type QueryValue = string | number | boolean | string[] | undefined;

/**
 * The one place that decides how a mapped value reaches the wire. Undefined is
 * dropped rather than sent as "undefined", and arrays repeat the key — which is
 * how `keyterm` travels on the STT sockets.
 */
export function buildUrl(
    baseUrl: string | undefined,
    path: string,
    params: Record<string, QueryValue> = {},
): URL {
    const url = new URL(path, baseUrl ?? DEFAULT_BASE_URL);

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const item of value) url.searchParams.append(key, item);
        } else {
            url.searchParams.set(key, String(value));
        }
    }
    return url;
}

/**
 * Cartesia authenticates with a bearer token and pins its schema with a version
 * header. The websockets send the same pair, so this is the single definition.
 */
export function authHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": CARTESIA_VERSION };
}

export interface SendInput {
    apiKey: string;
    url: URL;
    method?: string;
    body?: BodyInit;
    contentType?: string;
    /** Named in logs and in the timeout message. */
    operation: string;
    /** The response body is read incrementally, so it must stay cancellable. */
    stream?: boolean;
    transport: HttpHandler;
    context?: RequestContext;
}

/**
 * Everything generic — retry, backoff, deadlines, rate limiting — lives in
 * `@swungstudent/voice`. What is left here is only Cartesia's own: its auth
 * pair and the shape of its error envelope.
 */
export async function send({
    apiKey,
    url,
    method = "POST",
    body,
    contentType,
    operation,
    stream,
    transport,
    context,
}: SendInput): Promise<Response> {
    const headers: Record<string, string> = authHeaders(apiKey);
    // FormData must set its own header, boundary included.
    if (contentType) headers["Content-Type"] = contentType;

    const response = await transport({
        url,
        method,
        headers,
        body,
        signal: context?.signal,
        meta: {
            provider: PROVIDER,
            operation,
            attempt: 0,
            stream,
            retries: context?.retries,
            timeout: context?.timeout,
        },
    });

    if (!response.ok) throw await toError(response);
    return response;
}

/**
 * Cartesia reports failures a few ways depending on which tier rejected the
 * request — `{ error }` from the API, `{ message }` from the model server, and
 * the `{ title, message }` pair its sockets use. A bare "400 Bad Request" hides
 * which parameter it objected to, so all three are unwrapped.
 */
async function toError(response: Response): Promise<VoiceError> {
    const raw = await response.text().catch(() => "");
    let message = raw;

    try {
        const parsed = JSON.parse(raw) as {
            error?: string;
            message?: string;
            title?: string;
            detail?: string;
        };
        const summary = [parsed.title, parsed.message ?? parsed.error ?? parsed.detail]
            .filter(Boolean)
            .join(": ");
        if (summary) message = summary;
    } catch {
        /* not JSON; the raw body is the best we have */
    }

    return new VoiceError(`Cartesia request failed (${response.status}): ${message}`);
}
