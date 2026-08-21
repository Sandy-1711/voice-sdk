import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        exclude: ["test/live/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "text-summary", "lcov"],
            include: ["src/**"],
            thresholds: {
                statements: 95,
                branches: 91,
                functions: 87,
                lines: 95,
            },
        },
    },
});
