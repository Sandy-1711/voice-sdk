import type { ProviderOptions } from "./types";

/**
 * Applies `providerOptions` over a mapped request body.
 *
 * Nested plain objects merge one level deep, so reaching for a single
 * provider-specific setting does not silently drop the siblings a mapper
 * produced. Scalars, arrays and class instances replace outright.
 *
 * **A field the SDK reports back is not mergeable.** Where a mapped value also
 * appears in the result — the audio format, above all — apply it *after* this
 * call rather than passing it in, so `providerOptions` cannot change what goes
 * on the wire while the reported value stays as it was:
 *
 * ```ts
 * { ...withProviderOptions(body, input.providerOptions), output_format }
 * ```
 *
 * Everything a caller cannot observe from the result is fair game to merge.
 */
export function withProviderOptions<T extends object>(body: T, options?: ProviderOptions): T {
    if (!options) return body;

    const merged = { ...body } as Record<string, unknown>;
    for (const [key, override] of Object.entries(options)) {
        const current = merged[key];
        merged[key] =
            isPlainObject(current) && isPlainObject(override) ? { ...current, ...override } : override;
    }
    return merged as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
