# Contributing

Every change goes through an issue, a branch and a pull request. Nobody pushes to `main` directly.

## Before you start

- Pick an issue assigned to you. If it says "Depends on #n", wait until that issue is closed.
- If something needs doing and has no issue, open one first with the matching form.
- Set up the project and run the tests as described in the [README](README.md#development).

## Branches

Branch from an up-to-date `main` and name the branch after the kind of change:

| Prefix | For |
| --- | --- |
| `feat/` | new behaviour |
| `fix/` | bug fixes |
| `chore/` | tooling, CI, dependencies, repository settings |
| `test/` | tests only |
| `docs/` | documentation only |

Keep the rest short and descriptive: `feat/worker-health`, `chore/rust-ci`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org), the same style as the history:

```
feat(web): show missing secrets on the pipeline
fix(api): refuse releases that are missing secrets
chore(ci): run clippy on pull requests
```

The scope is the area you changed: `web`, `core`, `codegen`, `api`, `worker`, `db`, `server`, `ci`,
`ops`, `release` or `repo`. Write the summary in the imperative, lower case, without a full stop.
Use the body to explain why when it isn't obvious.

## Pull requests

- One issue per pull request. Put `Closes #n` in the description so the issue closes on merge.
- Fill in the template: what changed, how a reviewer can see it working, and the checklist.
- Keep the branch up to date with `main` and the checks green.
- A pull request needs an approval from a code owner (see `.github/CODEOWNERS`) before it can be merged.
- Merge with **Squash and merge** and use the pull request title as the commit message, so it has to
  follow the commit style above. Delete the branch afterwards.

## Running things locally

The [README](README.md#development) covers starting the services, the server, the worker and the
web app, and running the tests. Run the tests for every part you touched before asking for review.
