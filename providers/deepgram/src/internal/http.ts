import { createTransport, VoiceError } from "@swungstudent/voice";
import type { HttpHandler, RequestContext } from "@swungstudent/voice";
import { DEFAULT_BASE_URL, PROVIDER } from "../config";

export type QueryValue = string | number | boolean | string[] | undefined;

/** Deepgram configures everything through the query string, so this is the one
 * place that decides how a mapped value reaches the wire. Undefined is dropped
 * rather than sent as "undefined", and arrays repeat the key. */
export function buildUrl(
    baseUrl: string | undefined,
    path: string,
    params: Record<string, QueryValue>,
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

export interface SendInput {
    apiKey: string;
    url: URL;
    body: string | Uint8Array;
    contentType: string;
    /** Named in logs and in the timeout message. */
    operation?: string;
    /** The response body is read incrementally, so it must stay cancellable. */
    stream?: boolean;
    /** The provider's configured chain. Omitted, a default one is used. */
    transport?: HttpHandler;
    context?: RequestContext;
}

/**
 * Retry, backoff and deadlines now live in `@swungstudent/voice`, so this is
 * only the two things that are Deepgram's own: the token auth scheme, and
 * reading `{ err_code, err_msg }` out of a failure.
 */
let fallback: HttpHandler | undefined;

export async function send({
    apiKey,
    url,
    body,
    contentType,
    operation = "request",
    stream,
    transport,
    context,
}: SendInput): Promise<Response> {
    const handler = transport ?? (fallback ??= createTransport({ provider: PROVIDER }));

    const response = await handler({
        url,
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
        body: body as BodyInit,
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

    // The transport hands back failures rather than throwing them: only a
    // provider knows the shape of its own error envelope.
    if (!response.ok) throw await toError(response);
    return response;
}

/**
 * Deepgram reports failures as `{ err_code, err_msg }`, so the message is worth
 * unwrapping — a bare "400 Bad Request" hides which parameter was rejected.
 */
async function toError(response: Response): Promise<VoiceError> {
    const detail = await response.text().catch(() => "");
    let message = detail;

    try {
        const parsed = JSON.parse(detail) as { err_code?: string; err_msg?: string; message?: string };
        message = [parsed.err_code, parsed.err_msg ?? parsed.message].filter(Boolean).join(": ") || detail;
    } catch {
        /* not JSON; the raw body is the best we have */
    }

    return new VoiceError(`Deepgram request failed (${response.status}): ${message}`);
}
