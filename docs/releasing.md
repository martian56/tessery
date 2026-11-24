# Releasing Tessery

A release is a version tag pushed to GitHub. Merging to `main` never releases anything. The tag starts
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the images, publishes them and
creates the GitHub Release that running installations check for updates.

## Versions

Tessery uses `major.minor.patch`. Until 1.0, bump the minor version for new features and anything that needs care
when updating, and the patch version for fixes only. The version lives in one place, `[workspace.package]` in
`apps/server/Cargo.toml`, and the tag must match it.

## Cutting a release

1. **Bump the version.** On a branch from an up-to-date `main`, change `version` under `[workspace.package]` in
   `apps/server/Cargo.toml`, then refresh the lockfile:

   ```sh
   cd apps/server && cargo update --workspace
   ```

   Open a pull request titled `chore: release 0.2.0` and merge it once the checks pass.

2. **Tag the merge commit and push the tag:**

   ```sh
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. **Watch the workflow** under Actions → release. It runs three jobs:

   | Job | What it does |
   |---|---|
   | `version` | Fails if the tag and `Cargo.toml` disagree. |
   | `images` | Builds `tessery-server` and `tessery-worker` with the version baked in and pushes them as `0.2.0` and `latest`. |
   | `release` | Publishes the GitHub Release with a table of the images and notes generated from the merged pull requests. |

4. **Check the result:**

   ```sh
   gh release view v0.2.0
   gh api repos/martian56/tessery/releases/latest --jq .tag_name
   docker run --rm ghcr.io/martian56/tessery-server:0.2.0 env | grep TESSERY_VERSION
   ```

   Installations pick the release up within ten minutes and show admins the Update pill.

The release notes list the titles of the pull requests merged since the last tag, so write titles that make sense to
someone running Tessery. Edit the notes on the release page afterwards if something needs explaining, such as a
database change that makes rolling back risky.

## Pre-releases

Tag with a suffix to try a release before offering it to everyone:

```sh
git tag v0.3.0-rc.1
git push origin v0.3.0-rc.1
```

`Cargo.toml` says `0.3.0`; the check compares it with the part of the tag before the `-`. The images are pushed as
`0.3.0-rc.1` only, never as `latest`, and the GitHub Release is marked as a pre-release, so installations don't offer
it as an update. To try it on a test installation, set `TESSERY_IMAGE_TAG=0.3.0-rc.1` in its `.env` and run
`docker compose up -d`.

## When something goes wrong

- **The `version` job fails.** The tag doesn't match `Cargo.toml`. Delete the tag (`git push origin :v0.2.0` and
  `git tag -d v0.2.0`), fix the version through a pull request and tag again.
- **The `images` or `release` job fails.** Fix the cause, then run the workflow again from Actions → release → Run
  workflow with the tag, such as `v0.2.0`. Images that were already published are left as they are, so running it
  again never changes a published version.
- **A release is broken.** Published versions are never replaced. Fix it on `main` and release the next patch
  version. Installations on the broken version can roll back from the Updates page in the meantime.
