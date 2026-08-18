import { describe, expect, it } from "vitest";
import { withProviderOptions } from "../src/index";

describe("withProviderOptions", () => {
    it("returns the body untouched when there are no options", () => {
        const body = { model: "a" };
        expect(withProviderOptions(body)).toBe(body);
        expect(withProviderOptions(body, undefined)).toBe(body);
    });

    it("never mutates the body it was given", () => {
        const body = { model: "a" };
        const merged = withProviderOptions(body, { model: "b" });

        expect(body).toEqual({ model: "a" });
        expect(merged).not.toBe(body);
    });

    it("adds keys the mapper did not produce", () => {
        expect(withProviderOptions({ model: "a" }, { seed: 7 })).toEqual({ model: "a", seed: 7 });
    });

    it("replaces scalars outright", () => {
        expect(withProviderOptions({ model: "a", speed: 1 }, { speed: 2 })).toEqual({ model: "a", speed: 2 });
    });

    // The regression this function exists for: reaching for one nested setting
    // used to drop every sibling the mapper had already produced.
    it("merges nested plain objects one level deep, keeping mapped siblings", () => {
        const merged = withProviderOptions(
            { output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 } },
            { output_format: { sample_rate: 24000 } },
        );

        expect(merged).toEqual({
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
        });
    });

    it("stops at one level - a nested-nested object replaces", () => {
        const merged = withProviderOptions(
            { a: { keep: 1, deep: { x: 1, y: 2 } } },
            { a: { deep: { y: 3 } } },
        );

        expect(merged).toEqual({ a: { keep: 1, deep: { y: 3 } } });
    });

    it("replaces arrays rather than merging them", () => {
        expect(withProviderOptions({ keyterms: ["a", "b"] }, { keyterms: ["c"] })).toEqual({ keyterms: ["c"] });
    });

    it("replaces class instances, which are not safe to spread", () => {
        const url = new URL("https://example.test/a");
        const replacement = new URL("https://example.test/b");

        const merged = withProviderOptions({ url }, { url: replacement });

        expect(merged.url).toBe(replacement);
    });

    it("treats a null-prototype object as plain and merges it", () => {
        const body = { headers: { a: "1" } };
        const override = Object.assign(Object.create(null) as Record<string, unknown>, { b: "2" });

        expect(withProviderOptions(body, { headers: override })).toEqual({ headers: { a: "1", b: "2" } });
    });

    it("lets an override blank a mapped value out", () => {
        expect(withProviderOptions({ speed: 1 }, { speed: null })).toEqual({ speed: null });
        expect(withProviderOptions({ speed: 1 }, { speed: undefined })).toEqual({ speed: undefined });
    });

    it("replaces when only one side is an object", () => {
        expect(withProviderOptions({ voice: "id" }, { voice: { mode: "id", id: "x" } })).toEqual({
            voice: { mode: "id", id: "x" },
        });
        expect(withProviderOptions({ voice: { mode: "id" } }, { voice: "id" })).toEqual({ voice: "id" });
    });
});
