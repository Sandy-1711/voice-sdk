import type { ProviderOptions } from "./types";

/**
 * Applies `providerOptions` over a mapped request body.
 *
 * Nested plain objects merge one level deep, so reaching for a single
 * provider-specific setting does not silently drop the siblings a mapper
 * produced. Scalars, arrays and class instances replace outright.
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
