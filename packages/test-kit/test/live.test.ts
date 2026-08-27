// LIVE_TEST_* are synthetic names this file sets and reads itself; they are not
// inputs to any turbo task, so declaring them there would be a lie.
/* eslint-disable turbo/no-undeclared-env-vars */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    loadLiveEnv,
    requireLiveKey,
    SPOKEN_SAMPLE_RATE,
    SPOKEN_SAMPLE_TEXT,
    spokenSample,
} from "../src/index";

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

describe("spokenSample", () => {
    it("is a whole number of s16le mono samples", () => {
        expect(spokenSample().byteLength % 2).toBe(0);
    });

    // A fixture that decodes to silence would make every STT test pass for the
    // wrong reason, so check there is actually signal in it.
    it("carries real signal, not silence", () => {
        const audio = spokenSample();
        const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);

        let peak = 0;
        for (let at = 0; at < audio.byteLength; at += 2) {
            peak = Math.max(peak, Math.abs(view.getInt16(at, true)));
        }

        expect(peak).toBeGreaterThan(1000);
    });

    it("is long enough to be a sentence", () => {
        const seconds = spokenSample().byteLength / 2 / SPOKEN_SAMPLE_RATE;

        expect(seconds).toBeGreaterThan(1);
    });

    it("is headerless, so it can be pushed straight at a realtime session", () => {
        expect(Buffer.from(spokenSample().subarray(0, 4)).toString("ascii")).not.toBe("RIFF");
    });

    it("reads the same bytes every time", () => {
        expect(spokenSample()).toBe(spokenSample());
    });

    it("says what SPOKEN_SAMPLE_TEXT claims it says", () => {
        expect(SPOKEN_SAMPLE_TEXT.toLowerCase()).toContain("book a table");
    });
});
