# Release procedure

waxlens is not yet published to npm. This document is the **planned**
procedure for the eventual cut-over; nothing here has been executed
yet, and the steps below are intentionally manual rather than automated
so the first release is reviewable end-to-end.

Release notes are not maintained in a `CHANGELOG.md`. Instead, the
release-time write-up lives in the **GitHub Release** for the
corresponding tag — `git log` and the PR descriptions are the
single source of truth for "what changed", and the GitHub Release
body curates that into a human-readable summary at publish time.

## Pre-flight (do this before every release, including the first)

1. **Trunk is green.** The `check` and `pack-smoke` workflows are
   passing on `develop` / `main`.
2. **`npm publish --dry-run` is clean** in CI. The job lives in
   `.github/workflows/pack-smoke.yml` and runs on every PR, so the
   commit you're about to release has already been validated.
3. **`git log` since the previous tag** has been reviewed. This is
   the input you'll paraphrase into the GitHub Release body in step 6.
4. **No uncommitted local changes** — `git status` is clean.

## Cutting `0.1.0` (the first published release)

1. **Bump the version**:
   ```sh
   npm version 0.1.0
   ```
   `npm version` writes `package.json`, creates a commit, and tags
   `v0.1.0`. The default tag prefix is `v` — keep it; everything
   downstream (GitHub release pages, etc.) expects it.
2. **Re-run `check`**:
   ```sh
   npm run check
   ```
   Belt-and-braces: the `prepublishOnly` script runs this again before
   `npm publish`, but verifying ahead of time keeps the publish output
   tidy.
3. **Publish**:
   ```sh
   npm publish
   ```
   `prepublishOnly` runs `npm run check && npm run build` automatically;
   if either fails, the publish aborts.
4. **Push commit + tag**:
   ```sh
   git push origin develop --follow-tags
   ```
   (Or whatever the trunk branch is.)
5. **Smoke `npx waxlens`** from a clean directory:
   ```sh
   mkdir -p /tmp/waxlens-rel && cd /tmp/waxlens-rel
   npx --yes waxlens@0.1.0 --version
   ```
   Should print `0.1.0`.
6. **Write the GitHub Release**. Open the pushed tag on GitHub, draft
   a release, paste a short summary keyed off `git log v<prev>..v0.1.0`.
   This is where users discover what's new; `git log` alone is too
   noisy to expect them to read.

## Subsequent releases (`0.x.y`)

Identical, with one difference: version bump is
`npm version <patch|minor>` rather than the literal `0.1.0`.

Avoid `npm version major` until the `0.x` line stabilises — see the
stability promise in [`docs/json-schema.md`](json-schema.md).

## If something goes wrong mid-publish

- **`prepublishOnly` failed.** The publish was aborted. Fix the failure
  and re-run `npm publish` (no version bump needed; the commit and tag
  from `npm version` already exist).
- **`npm publish` succeeded but smoke fails.** Don't unpublish — npm's
  policy makes re-publishing the same version difficult. Instead, cut
  a patch with the fix; mention the broken predecessor in the patch's
  GitHub Release body so users searching for the bad version land on
  the workaround.
- **`git push` failed.** Re-run `git push origin <branch> --follow-tags`
  once the conflict is resolved. The tag is local until pushed.

## What lives where (for the auditor)

| Thing                        | File                                          |
| ---------------------------- | --------------------------------------------- |
| Version bumped on release    | `package.json#version`                        |
| Pre-publish gate             | `package.json#scripts.prepublishOnly`         |
| Files shipped in the tarball | `package.json#files`                          |
| Bin entry                    | `package.json#bin`                            |
| Build output (gitignored)    | `dist/`                                       |
| Tarball smoke in CI          | `.github/workflows/pack-smoke.yml`            |
| Dry-run validation in CI     | `.github/workflows/pack-smoke.yml` (same job) |
| Release notes                | GitHub Releases for each `v<x.y.z>` tag       |
