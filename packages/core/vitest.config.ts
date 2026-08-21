import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "text-summary", "lcov", "json-summary"],
            include: ["src/**"],
            thresholds: {
                statements: 96,
                branches: 90,
                functions: 95,
                lines: 97,
            },
        },
    },
});
