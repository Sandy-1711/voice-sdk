/**
 * Compiles a consumer against what we would actually publish.
 *
 * `pnpm test` runs against `src` and `check-types` typechecks the workspace;
 * neither touches `dist` or the manifest a consumer resolves. The `types` and
 * `exports` fields point at source in-repo and are swapped to `dist` by
 * `publishConfig` at publish time — an override `pnpm publish` applies and
 * plain `npm publish` ignores. Nothing tested that, and getting it wrong ships
 * packages with no types at all.
 *
 * So: pack with pnpm (never npm, or the override under test is not applied),
 * check the packed manifests, install the tarballs the way a user would, and
 * compile the fixture against them under both module resolutions.
 *
 *   node scripts/consumer-check.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const PACKAGES = [
    { dir: "packages/core", name: "@swungstudent/voice" },
    { dir: "providers/cartesia", name: "@swungstudent/cartesia" },
    { dir: "providers/deepgram", name: "@swungstudent/deepgram" },
    { dir: "providers/elevenlabs", name: "@swungstudent/elevenlabs" },
];

const failures = [];

function check(name, condition, detail = "") {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        encoding: "utf8",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
}

const workspace = mkdtempSync(join(tmpdir(), "voice-sdk-consumer-"));
const tarballs = join(workspace, "tarballs");
const consumer = join(workspace, "consumer");
mkdirSync(tarballs);
mkdirSync(consumer);

try {
    console.log(`packing into ${tarballs}\n`);

    const packed = [];
    for (const { dir, name } of PACKAGES) {
        // pnpm, not npm: npm ignores the publishConfig keys this exists to test.
        run("pnpm", ["pack", "--pack-destination", JSON.stringify(tarballs)], {
            cwd: join(ROOT, dir),
        });

        const file = readdirSync(tarballs).find((entry) => entry.startsWith(fileStem(name)));
        if (!file) {
            check(`${name} packs`, false, `no tarball in ${tarballs}`);
            continue;
        }
        packed.push({ name, dir, file });
    }

    console.log("\nmanifests as a consumer resolves them\n");

    for (const { name, file } of packed) {
        // Bare filenames from inside the directory: GNU tar reads a Windows
        // path as host:path and tries to resolve the drive letter as a host.
        const tarOptions = { cwd: tarballs };
        const manifest = JSON.parse(run("tar", ["-xOf", file, "package/package.json"], tarOptions));
        const entries = run("tar", ["-tf", file], tarOptions);

        const points = (value) => typeof value === "string" && value.startsWith("./dist/");

        check(
            `${name} types point into dist`,
            points(manifest.types),
            `types is ${JSON.stringify(manifest.types)} — publishConfig was not applied, so the package ships untyped`,
        );
        check(
            `${name} exports types point into dist`,
            points(manifest.exports?.["."]?.types),
            `exports["."].types is ${JSON.stringify(manifest.exports?.["."]?.types)}`,
        );
        check(`${name} main and module point into dist`, points(manifest.main) && points(manifest.module));
        check(`${name} ships the declarations it points at`, entries.includes("package/dist/index.d.ts"));

        // `workspace:^` is meaningless to a consumer; pnpm rewrites it on pack.
        const specs = Object.values({
            ...(manifest.dependencies ?? {}),
            ...(manifest.peerDependencies ?? {}),
        });
        check(
            `${name} has no workspace: specifiers left`,
            !specs.some((spec) => String(spec).startsWith("workspace:")),
            specs.filter((spec) => String(spec).startsWith("workspace:")).join(", "),
        );
    }

    console.log("\ninstalling the tarballs into a scratch consumer\n");

    writeFileSync(
        join(consumer, "package.json"),
        `${JSON.stringify({ name: "consumer", version: "1.0.0", private: true, type: "module" }, null, 2)}\n`,
    );
    const paths = packed.map((entry) => JSON.stringify(join(tarballs, entry.file)));
    run("npm", ["install", "--no-audit", "--no-fund", ...paths], { cwd: consumer });
    check("the tarballs install", true);

    copyFileSync(join(ROOT, "scripts/consumer-check/fixture.ts"), join(consumer, "fixture.ts"));

    // Both resolutions: nodenext is the strict one, and the only one that
    // notices a types condition missing from a branch of the exports map.
    for (const moduleResolution of ["bundler", "nodenext"]) {
        const config = join(consumer, `tsconfig.${moduleResolution}.json`);
        writeFileSync(
            config,
            `${JSON.stringify(
                {
                    compilerOptions: {
                        target: "ES2022",
                        module: moduleResolution === "nodenext" ? "nodenext" : "ESNext",
                        moduleResolution,
                        strict: true,
                        // The point of the exercise: read the real .d.ts files.
                        skipLibCheck: false,
                        noEmit: true,
                        types: [],
                    },
                    files: ["./fixture.ts"],
                },
                null,
                2,
            )}\n`,
        );

        try {
            run("node", [
                JSON.stringify(join(ROOT, "node_modules/typescript/bin/tsc")),
                "-p",
                JSON.stringify(config),
            ]);
            check(`the fixture compiles under moduleResolution: ${moduleResolution}`, true);
        } catch (error) {
            const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
            check(`the fixture compiles under moduleResolution: ${moduleResolution}`, false, `\n${output}`);
        }
    }
} finally {
    rmSync(workspace, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);

/** `@swungstudent/voice` packs as `swungstudent-voice-0.0.0.tgz`. */
function fileStem(name) {
    return name.replace("@", "").replace("/", "-");
}
