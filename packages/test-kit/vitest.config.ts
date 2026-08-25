import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "text-summary", "lcov", "json-summary"],
            include: ["src/**"],
            thresholds: {
                statements: 97,
                branches: 88,
                functions: 100,
                lines: 99,
            },
        },
    },
});
