import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * Configuration for the published SDK packages.
 *
 * Differs from `./base` in two ways that matter for library code: rules are
 * type-aware, so they can see through a signature into what a value actually
 * is; and violations are errors, not warnings, because `only-warn` makes a
 * failing lint indistinguishable from a passing one in the exit code.
 *
 * `strictTypeChecked` is deliberately not used. It adds three rules that fight
 * idioms this codebase uses on purpose: `no-confusing-void-expression` rejects
 * `() => void this.close()`, and `prefer-nullish-coalescing` rejects
 * `Number(x) || 0`, where `||` is correct because the guard is against NaN.
 *
 * @param {string} tsconfigRootDir Directory holding the package's tsconfig.
 * @returns {import("eslint").Linter.Config[]}
 */
export const config = (tsconfigRootDir) => [
  // `test/node18/` holds plain-JS scripts that run against `dist/` on the
  // oldest supported node, outside the typed build the rules below need.
  { ignores: ["dist/**", "coverage/**", "test/node18/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir,
      },
    },
    rules: {
      // AbortSignal.reason is `any`, and rejecting with it is exactly right:
      // it forwards the caller's own reason rather than inventing an Error.
      "@typescript-eslint/prefer-promise-reject-errors": "off",

      // Several interface methods return Promise but have nothing to await —
      // `flush()` on a session that sends synchronously, `openTTSSession()`
      // wrapping a synchronous constructor. The `async` is load-bearing even
      // so: it turns a synchronous throw into a rejection, which is what the
      // caller of a Promise-returning method expects.
      "@typescript-eslint/require-await": "off",

      // AsyncQueue.fail() takes whatever a socket handed it and rethrows it to
      // the iterating caller. Wrapping it in an Error would hide the original.
      "@typescript-eslint/only-throw-error": ["error", { allowThrowingUnknown: true }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    plugins: { turbo: turboPlugin },
    rules: { "turbo/no-undeclared-env-vars": "warn" },
  },

  {
    // Test code leans on `any` through vi.fn() and hand-built wire payloads.
    // no-floating-promises stays on: a missing `await expect(...)` is a bug
    // that silently passes.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },

  // Last, so it can switch off anything stylistic the rules above turned on.
  eslintConfigPrettier,
];
