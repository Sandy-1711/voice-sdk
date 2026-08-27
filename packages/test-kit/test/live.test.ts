// LIVE_TEST_* are synthetic names this file sets and reads itself; they are not
// inputs to any turbo task, so declaring them there would be a lie.
/* eslint-disable turbo/no-undeclared-env-vars */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSpeech, loadLiveEnv, requireLiveKey } from "../src/index";

const NAMES = ["LIVE_TEST_KEY", "LIVE_TEST_OTHER", "VOICE_LIVE_REQUIRE_KEYS"];

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "voice-live-"));
});

// Deleting the names one by one rather than reassigning process.env: assigning
// a plain object detaches it from the real environment, and loadEnvFile writes
// to that, so the loaded values would be invisible to every later read.
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const name of NAMES) delete process.env[name];
});

describe("loadLiveEnv", () => {
    it("loads the .env sitting in the directory itself", () => {
        writeFileSync(join(dir, ".env"), "LIVE_TEST_KEY=from-file\n");

        expect(loadLiveEnv(dir)).toBe(join(dir, ".env"));
        expect(process.env.LIVE_TEST_KEY).toBe("from-file");
    });

    // The point of walking up: `pnpm --filter <provider> test:live` runs with
    // the provider package as cwd, but the .env lives at the repo root.
    it("walks up to find a .env in an ancestor", () => {
        const nested = join(dir, "providers", "cartesia");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(dir, ".env"), "LIVE_TEST_KEY=from-ancestor\n");

        expect(loadLiveEnv(nested)).toBe(join(dir, ".env"));
        expect(process.env.LIVE_TEST_KEY).toBe("from-ancestor");
    });

    it("stops at the filesystem root rather than looping", () => {
        expect(loadLiveEnv(join(dir, "no", "env", "here"))).toBeUndefined();
    });

    // A local .env must never shadow a secret injected by CI.
    it("keeps a value already in the environment", () => {
        process.env.LIVE_TEST_KEY = "from-ci";
        writeFileSync(join(dir, ".env"), "LIVE_TEST_KEY=from-file\n");

        loadLiveEnv(dir);

        expect(process.env.LIVE_TEST_KEY).toBe("from-ci");
    });

    it("still loads the names the environment does not already have", () => {
        process.env.LIVE_TEST_KEY = "from-ci";
        writeFileSync(join(dir, ".env"), "LIVE_TEST_KEY=from-file\nLIVE_TEST_OTHER=also-from-file\n");

        loadLiveEnv(dir);

        expect(process.env.LIVE_TEST_OTHER).toBe("also-from-file");
    });
});

describe("requireLiveKey", () => {
    it("returns the key when it is set", () => {
        process.env.LIVE_TEST_KEY = "secret";

        expect(requireLiveKey("LIVE_TEST_KEY")).toBe("secret");
    });

    it("returns undefined when it is absent, so the suite skips", () => {
        delete process.env.LIVE_TEST_KEY;

        expect(requireLiveKey("LIVE_TEST_KEY")).toBeUndefined();
    });

    // The whole reason this helper exists: a scheduled run with no secrets has
    // to go red rather than pass having proven nothing.
    it("throws instead of skipping when VOICE_LIVE_REQUIRE_KEYS is set", () => {
        delete process.env.LIVE_TEST_KEY;
        process.env.VOICE_LIVE_REQUIRE_KEYS = "1";

        expect(() => requireLiveKey("LIVE_TEST_KEY")).toThrow(/LIVE_TEST_KEY is not set/);
    });

    it("does not throw when the key is present and the guard is on", () => {
        process.env.LIVE_TEST_KEY = "secret";
        process.env.VOICE_LIVE_REQUIRE_KEYS = "1";

        expect(requireLiveKey("LIVE_TEST_KEY")).toBe("secret");
    });

    it("treats an empty key as missing", () => {
        process.env.LIVE_TEST_KEY = "";

        expect(requireLiveKey("LIVE_TEST_KEY")).toBeUndefined();
    });
});

describe("cachedSpeech", () => {
    it("synthesizes and writes on a cold cache", async () => {
        const file = join(dir, ".fixtures", "spoken.raw");
        const synthesize = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

        await expect(cachedSpeech(file, synthesize)).resolves.toEqual(new Uint8Array([1, 2, 3]));
        expect(synthesize).toHaveBeenCalledTimes(1);
        expect(new Uint8Array(readFileSync(file))).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("reads the file back without synthesizing again", async () => {
        const file = join(dir, "spoken.raw");
        writeFileSync(file, new Uint8Array([9, 8, 7]));
        const synthesize = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

        await expect(cachedSpeech(file, synthesize)).resolves.toEqual(new Uint8Array([9, 8, 7]));
        expect(synthesize).not.toHaveBeenCalled();
    });
});
