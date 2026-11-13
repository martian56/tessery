# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/martian56/tessery/security/advisories/new) for this
repository.

Include what you found, how to reproduce it and what an attacker could do with it. We will confirm we
received it within three days, keep you updated while we work on a fix, and credit you in the release
notes unless you prefer otherwise.

## Supported versions

Fixes go into the latest release. Self-hosted instances get them through the normal update path.

## Scope

In scope: the Tessery server, worker and web app in this repository, the deploy runner, and the
self-hosting files in `deploy/`. Applications that Tessery generates are in scope where the problem
comes from the generated code itself.
