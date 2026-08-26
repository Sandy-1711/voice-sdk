import { config } from "@voice-sdk/eslint-config/library";

export default [
    ...config(import.meta.dirname),
    {
        // These run by hand, not through turbo, so their keys have no task to be
        // declared on.
        rules: { "turbo/no-undeclared-env-vars": "off" },
    },
];
