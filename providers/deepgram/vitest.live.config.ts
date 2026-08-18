import { defineConfig } from "vitest/config";

/** The opt-in tier: real APIs, real keys, real money. Never runs in CI. */
export default defineConfig({
    test: {
        include: ["test/live/**/*.test.ts"],
        testTimeout: 60_000,
        hookTimeout: 60_000,
        retry: 1,
        fileParallelism: false,
    },
});
