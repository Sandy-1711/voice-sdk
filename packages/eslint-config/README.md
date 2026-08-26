# `@voice-sdk/eslint-config`

The repository's shared ESLint configurations.

| Export      | Used by                                                        |
| ----------- | -------------------------------------------------------------- |
| `./library` | `packages/*`, `providers/*`, `examples/*` — type-aware, errors |
| `./next-js` | `apps/web`                                                     |
| `./base`    | the two above build on it                                      |

`./library` differs from `./base` in two ways that matter for library code:
rules are type-aware, and violations are errors rather than warnings. Every
disabled rule in it carries a one-line reason.
