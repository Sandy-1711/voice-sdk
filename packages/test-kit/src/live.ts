import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

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

/**
 * Synthesized speech, reused across runs. Most live tests need *some* audio to
 * transcribe rather than a fresh synthesis of it, and that duplicated TTS is
 * the bulk of what the tier costs to iterate on.
 *
 * `file` is gitignored, so a cold run still exercises the real round trip.
 */
export async function cachedSpeech(file: string, synthesize: () => Promise<Uint8Array>): Promise<Uint8Array> {
    if (existsSync(file)) return new Uint8Array(readFileSync(file));

    const audio = await synthesize();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, audio);

    return audio;
}

function findEnvFile(cwd: string): string | undefined {
    const { root } = parse(cwd);

    for (let at = cwd; ; at = dirname(at)) {
        const file = join(at, ".env");
        if (existsSync(file)) return file;
        if (at === root) return undefined;
    }
}
