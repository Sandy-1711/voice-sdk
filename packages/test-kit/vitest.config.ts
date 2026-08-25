import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "text-summary", "lcov", "json-summary"],
            include: ["src/**"],
            thresholds: {
                statements: 0,
                branches: 0,
                functions: 0,
                lines: 0,
            },
        },
    },
});
