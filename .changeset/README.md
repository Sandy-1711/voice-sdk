# Changesets

Every user-facing change gets a changeset — a short note saying which packages
changed and how much. Run:

```sh
pnpm changeset
```

pick the packages, pick patch / minor / major, and write one line describing the
change from a user's point of view. That line becomes the changelog entry, so
write it for someone upgrading, not for someone reviewing the diff.

Nothing publishes from your machine. On merge to `main`, CI opens (or updates) a
release pull request that applies every pending changeset — bumping versions and
writing changelogs. Merging that pull request is what publishes to npm.

The four published packages are **linked**: they share a version line, so a
release moves them together and matching versions mean packages that were built
and tested against each other.

`@voice-sdk/test-kit` is private and never publishes.
