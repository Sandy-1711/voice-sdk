import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Set this to turn a missing key from a skip into a failure. The live tier is
 * gated on `describe.skipIf(!KEY)`, so a run without keys otherwise reports
 * green having proven nothing — which is exactly what a scheduled run must not
 * be allowed to do.
 */
const REQUIRE = "VOICE_LIVE_REQUIRE_KEYS";

/**
 * Loads the nearest `.env` walking up from `cwd`, so the live tier works from a
 * provider directory or the repo root. Values already in `process.env` win, so
 * a stray local file can never shadow a secret injected by CI.
 */
export function loadLiveEnv(cwd = process.cwd()): string | undefined {
    const file = findEnvFile(cwd);
    if (!file) return undefined;

    const before = { ...process.env };
    process.loadEnvFile(file);
    for (const [key, value] of Object.entries(before)) {
        if (value !== undefined) process.env[key] = value;
    }

    return file;
}

/**
 * The key for a live suite, or `undefined` when it is absent and the suite
 * should skip. Throws instead when {@link REQUIRE} is set.
 */
export function requireLiveKey(name: string): string | undefined {
    const value = process.env[name];
    if (value) return value;

    if (process.env[REQUIRE]) {
        throw new Error(
            `${name} is not set, and ${REQUIRE} forbids skipping. Either provide the key or unset ${REQUIRE}.`,
        );
    }

    return undefined;
}

/** What {@link spokenSample} says, so a transcript assertion can quote it. */
export const SPOKEN_SAMPLE_TEXT =
    "Hello there. I would like to book a table for two people tomorrow evening.";

/** The sample's sample rate; mono, s16le, and headerless. */
export const SPOKEN_SAMPLE_RATE = 16000;

const SAMPLE_FILE = fileURLToPath(new URL("../fixtures/spoken-16k.pcm", import.meta.url));
let sample: Uint8Array | undefined;

/**
 * A fixed clip of speech for the STT tests to transcribe.
 *
 * Checked in rather than synthesized, because an STT test that speaks first is
 * two tests wearing a trenchcoat: a TTS regression turns every STT test red and
 * the transcript assertion stops meaning anything. Both halves are covered on
 * their own elsewhere.
 *
 * Raw s16le at {@link SPOKEN_SAMPLE_RATE}, which is what every realtime STT
 * path takes; wrap it with `wav()` for the batch endpoints.
 */
export function spokenSample(): Uint8Array {
    sample ??= new Uint8Array(readFileSync(SAMPLE_FILE));
    return sample;
}

function findEnvFile(cwd: string): string | undefined {
    const { root } = parse(cwd);

    for (let at = cwd; ; at = dirname(at)) {
        const file = join(at, ".env");
        if (existsSync(file)) return file;
        if (at === root) return undefined;
    }
}
