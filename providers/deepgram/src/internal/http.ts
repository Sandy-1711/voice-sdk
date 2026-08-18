import { VoiceError } from "@swungstudent/voice";
import type { RequestContext } from "@swungstudent/voice";
import { DEFAULT_BASE_URL } from "../config";

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
    context?: RequestContext;
}

/** Retried on 429 and 5xx, which are the failures a second attempt can fix. */
const DEFAULT_RETRIES = 2;

export async function send({ apiKey, url, body, contentType, context }: SendInput): Promise<Response> {
    const retries = context?.retries ?? DEFAULT_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) await backoff(attempt, context?.signal);

        const { signal, done } = deadline(context);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
                body: body as BodyInit,
                signal,
            });

            if (response.ok) return response;
            if (!isRetryable(response.status) || attempt === retries) throw await toError(response);
            lastError = await toError(response);
        } catch (error) {
            // A caller-initiated abort is the answer, not a failure to retry.
            if (context?.signal?.aborted) throw error;
            if (error instanceof VoiceError || attempt === retries) throw error;
            lastError = error;
        } finally {
            done();
        }
    }

    throw lastError;
}

function isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
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

/** Combines the caller's signal with the per-request timeout. */
function deadline(context: RequestContext | undefined): { signal: AbortSignal | undefined; done: () => void } {
    const outer = context?.signal;
    if (context?.timeout === undefined) return { signal: outer, done: () => {} };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Deepgram request timed out")), context.timeout);
    const forward = () => controller.abort(outer?.reason);

    if (outer?.aborted) forward();
    else outer?.addEventListener("abort", forward, { once: true });

    return {
        signal: controller.signal,
        done: () => {
            clearTimeout(timer);
            outer?.removeEventListener("abort", forward);
        },
    };
}

function backoff(attempt: number, signal: AbortSignal | undefined): Promise<void> {
    const delay = Math.min(500 * 2 ** (attempt - 1), 4000) * (0.5 + Math.random() / 2);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}
