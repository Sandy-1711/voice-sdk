import { VoiceError } from "@swungstudent/voice";
import type { HttpHandler, RequestContext } from "@swungstudent/voice";
import { DEFAULT_BASE_URL, PROVIDER } from "../config";

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
 * Everything generic — retry, backoff, deadlines — lives in
 * `@swungstudent/voice`. What is left here is only ElevenLabs' own: the
 * `xi-api-key` header and the shape of its error envelope.
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
    const headers: Record<string, string> = { "xi-api-key": apiKey };
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
 * ElevenLabs reports failures as `{ detail }`, where detail is either a string
 * or `{ status, message }`. A bare "422 Unprocessable Entity" hides which field
 * it objected to.
 */
async function toError(response: Response): Promise<VoiceError> {
    const raw = await response.text().catch(() => "");
    let message = raw;

    try {
        const parsed = JSON.parse(raw) as {
            detail?: string | { status?: string; message?: string };
            message?: string;
        };
        const detail = parsed.detail;

        if (typeof detail === "string") message = detail;
        else if (detail) message = [detail.status, detail.message].filter(Boolean).join(": ") || raw;
        else if (parsed.message) message = parsed.message;
    } catch {
        /* not JSON; the raw body is the best we have */
    }

    return new VoiceError(`ElevenLabs request failed (${response.status}): ${message}`);
}

/**
 * The mappers speak camelCase, the API speaks snake_case. The generated client
 * used to bridge the two, so this keeps doing it — including for the caller's
 * own `providerOptions`, which would otherwise silently stop reaching the wire
 * under their documented names.
 *
 * Keys only. Values, including binary bodies, are never touched.
 */
export function snakeify<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => snakeify(item)) as T;
    if (!isPlainObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[toSnakeCase(key)] = snakeify(item);
    return out as T;
}

/** Already-snake_case keys have no capitals, so they pass through untouched. */
function toSnakeCase(key: string): string {
    return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * The other direction, for responses. `labels` is exempt because its keys are
 * the caller's own, not part of the schema — the generated client left them
 * alone too, and camelising `use_case` into `useCase` would silently rename a
 * voice's metadata.
 */
const OPAQUE_KEYS = new Set(["labels"]);

export function camelize<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => camelize(item)) as T;
    if (!isPlainObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        const name = toCamelCase(key);
        out[name] = OPAQUE_KEYS.has(name) ? item : camelize(item);
    }
    return out as T;
}

function toCamelCase(key: string): string {
    return key.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false;
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
}
