---
name: releasing
description: How to cut and publish a release of the voice SDK packages to npm — the changesets loop, the constraints that are not visible in the config, and the failure modes this repo has actually hit. Use when adding a changeset, debugging the Release workflow, publishing, or changing anything under .changeset/ or .github/workflows/release.yml.
---

# Releasing

Four packages publish to npm under the `@swungstudent` scope: `voice` (core),
`cartesia`, `deepgram`, `elevenlabs`. `@voice-sdk/test-kit` and
`@voice-sdk/typescript-config` are `"private": true` and must stay that way.

## The loop

1. **Declare** — `pnpm changeset` for any change a user would notice. Writes a
   markdown file to `.changeset/`. Commit it with the code it describes.
2. **Version** — on merge to `main`, `.github/workflows/release.yml` opens a PR
   titled `chore(release): version packages` that applies the pending
   changesets: bumps versions, writes CHANGELOGs, deletes the changeset files.
   Nothing is published at this point.
3. **Publish** — merging that PR re-runs the workflow, which now finds no
   pending changesets and runs `pnpm release` instead.

Merging the release PR *is* the publish button.

## Constraints that are not obvious from the config

**Publish must go through pnpm.** The providers declare
`"@swungstudent/voice": "workspace:^"` in `peerDependencies`. Only pnpm's
publish path rewrites that to a real semver range; `npm publish` would ship a
manifest containing a literal `workspace:^` and every install would fail.
`changeset publish` detects pnpm and delegates correctly — don't replace it
with a bare `npm publish`.

**All four versions move together.** `.changeset/config.json` puts them in one
`fixed` group. A changeset naming only `cartesia` still bumps the other three.
That is deliberate: matching versions are the guarantee that those packages
were built and tested against each other. Expect near-empty CHANGELOG entries
on the packages that only moved because of the group.

**`version-packages` must reinstall.** The script is
`changeset version && pnpm install --lockfile-only`. Without the second half
`pnpm-lock.yaml` goes stale and the next CI run fails on `--frozen-lockfile`.

**`access: "public"` is load-bearing.** Scoped packages default to private on
npm, and private needs a paid plan. Removing it breaks every publish.

**`publishConfig` swaps the entry points.** In-repo, `types` points at
`./src/index.ts` so the editor jumps to source and typechecking needs no build.
pnpm overwrites those fields from `publishConfig` at publish time so the tarball
points at `./dist/`. If you add a package, copy this pattern — an existing
provider's `package.json` is the reference.

**Build before publish.** `pnpm release` is
`turbo run build --filter=... && changeset publish` because `files: ["dist"]`
and `dist/` does not exist in a fresh CI checkout.

## Failure modes this repo has hit

**Published fine, but no tags and no GitHub release.**
`changesets/action@v1` works out what shipped by scraping
`New tag: <pkg>@<version>` from the publish command's stdout.
`@changesets/cli@3` no longer prints that line, so the action saw nothing
published and silently skipped pushing tags and cutting releases. Action **v2**
is the line that pairs with CLI v3; its inputs are kebab-case
(`version-script`, `publish-script`, `commit-message`, `pr-title`,
`github-token`) and it no longer writes its own `.npmrc`, so the registry
credential comes from the one `actions/setup-node` writes via
`NODE_AUTH_TOKEN`. Keep the action major and the CLI major in step.

This bit 0.1.1, whose tags and releases were backfilled by hand against
`d6ba649`. Tag format is `@swungstudent/<pkg>@<version>`, one per package.

**`GitHub Actions is not permitted to create or approve pull requests`.**
A repo setting, not a `permissions:` block. Either enable
*Settings → Actions → Allow GitHub Actions to create and approve pull requests*,
or open the PR by hand — the action still pushes the `changeset-release/main`
branch, so the work is done and only the PR is missing.

**`E403 ... Two-factor authentication or granular access token with bypass 2fa
enabled is required`.** The `NPM_TOKEN` secret needs bypass-2FA ticked.
`changeset publish` skips versions already on the registry, so a failed run is
safe to re-run — check with `npm view <pkg>@<version>` before assuming a
partial publish happened.

**Trusted Publishing (OIDC) is the eventual fix for that token**, but it was
blocked at 0.1.1 by two things: npm cannot do a package's *first* publish over
OIDC ([npm/cli#8544](https://github.com/npm/cli/issues/8544)), and pnpm 9
(pinned here) has no OIDC support. Both are now clearable — it needs
`id-token: write`, pnpm >= 10, and npm CLI >= 11.5.1.

**A stale branch double-applies a changeset.** `changeset version` *deletes*
the changeset files it consumes. A branch cut before a release still carries
files `main` has already applied, and merging it would apply them twice off a
wrong base version. Rebase onto `main` before adding a changeset to an older
branch.

## Checking the state

```sh
gh run list --workflow=release.yml --limit 5   # did the release job run, and which mode
gh release list                                # tags and releases actually landed
npm view @swungstudent/voice version           # what the registry really has
git ls-remote --tags origin                    # tags pushed, not just created locally
```

The `Packages` section on the repo home page is **GitHub Packages**
(`npm.pkg.github.com`), a different registry from npmjs.com. It will stay empty
and that is correct — nothing to fix there.

## Before a release that matters

```sh
pnpm test          # offline tier, no keys
pnpm check-types
pnpm build
DEEPGRAM_API_KEY=… CARTESIA_API_KEY=… ELEVENLABS_API_KEY=… pnpm test:live
```

The live tier is what catches a provider changing its wire format — the offline
fakes only encode what we *believe* each format is.