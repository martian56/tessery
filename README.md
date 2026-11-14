# Tessery

Tessery is a self-hosted platform for designing software systems and shipping them. You draw the
system (services, databases, queues and web apps), design each service's API, each database's
schema and each web app's pages. Tessery generates the code and the infrastructure, keeps both in
a git repository your developers push to, and deploys them through development, staging and
production.

## Features

- **Design.** A canvas of 69 technologies, an API designer (REST, GraphQL, gRPC, WebSocket), a
  schema designer and a page builder, all editing one design document with undo and history.
- **Generate.** Services in TypeScript, Go, Python, Rust, Java, Kotlin, Scala, C#, Ruby, PHP,
  Elixir, Swift, C++ and Zig, a Next.js web app, Docker Compose files and Kubernetes manifests.
  REST operations whose path names a table of a connected Postgres (`GET /orders`,
  `PATCH /orders/{id}`) are implemented in SQL for TypeScript, Go and Python, so a designed CRUD
  app works without writing code.
- **Users and sign-in.** Add the built-in identity provider and Tessery generates sign-up, sign-in,
  signed sessions, a login page, enforcement of operations marked for signed-in users or admins,
  and per-user rows for tables with a `user_id` column.
- **Git.** Every project has a repository at `/git/<project>.git`. Developers clone it with an API
  token, run it locally with `docker compose up --build` and push to `main`. A checkpoint commits
  what the design generates to `tessery/generated` and merges it into `main`, so design changes
  and hand-written code live together.
- **Deploy.** Environments form a pipeline: each one only accepts what the previous one runs, and
  any of them can require approval. Targets are Docker on the Tessery host, Docker on any machine
  over SSH, or Kubernetes. A throwaway runner container builds the images, starts everything and
  checks health, streaming its log to the UI. Environments with auto-rollback on return to the
  previous release when a deploy fails.
- **Operate.** Live status, CPU and memory, logs, traces, table browsing and SQL for every
  environment. Deployed services send OpenTelemetry traces to Tessery, which stores them and shows
  each request as a waterfall.
- **Agents.** An MCP server at `/api/mcp` lets Claude Code, Cursor or any MCP client design, build
  and deploy with the permissions of the token it uses.
- **Access control.** Organizations, teams, built-in and custom roles granted at organization,
  team, project or environment level, time-limited grants, scoped API tokens, single sign-on with
  any OpenID Connect provider and an audit log.

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Web app: React, Vite, Redux Toolkit, React Flow |
| `apps/server` | Rust workspace: `tessery-api` (HTTP server), `tessery-worker` (jobs and deploys), `tessery-db` (Postgres), `tessery-git`, `tessery-engine`, `tessery-mq`, `tessery-core` |
| `packages/core` | TypeScript design model, operations and code generators, used by the browser and by the server through a pool of Node processes |
| `docker-compose.yml` | Postgres, Redis and RabbitMQ for development, and the whole platform with `--profile app` |

## Development

Requirements: Docker, Node 22 or newer, Rust 1.99.1 and git.

```sh
docker compose up -d
cd packages/core && npm ci && npm run build:engine && cd ../..
cd apps/server && cp .env.example .env
cargo run --bin tessery-server
cargo run --bin tessery-worker
cd apps/web && npm ci && npm run dev
```

Set `TESSERY_SECRET_KEY` in `apps/server/.env` before starting the server (`openssl rand -hex 32`).
Run the server and the worker in separate terminals. The API listens on `http://127.0.0.1:8080`
and the web app on `http://localhost:5173`. The first visit asks you to create the instance
administrator.

Tests:

```sh
cd apps/server && cargo test --workspace
cd packages/core && npm test
cd apps/web && npx tsc --noEmit -p .
```

The Rust tests need the services from `docker compose up -d`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commit messages and pull requests.

## Self-hosting

On a Linux server with a domain pointing at it:

```sh
curl -fsSL https://raw.githubusercontent.com/martian56/tessery/main/deploy/install.sh | sudo bash
```

The script installs Docker if needed, asks for the domain, writes `/opt/tessery/.env` with generated
secrets and starts the published images behind Caddy, which serves HTTPS. Only ports 80 and 443 are
opened; Postgres, Redis and RabbitMQ stay on the internal network. Back up `.env`:
`TESSERY_SECRET_KEY` encrypts environment secrets, git credentials and provider credentials and cannot be
recovered.
Set `TESSERY_IMAGE_TAG` in `.env` to pin a version. Every variable is described in
[`deploy/.env.example`](deploy/.env.example).

Back up an install with `sudo /opt/tessery/backup.sh`. It writes one archive with the database, the project
repositories and `.env` to `/opt/tessery/backups`, and can also upload it to any S3-compatible bucket, such as
Cloudflare R2, when `TESSERY_BACKUP_S3_BUCKET`, `TESSERY_BACKUP_S3_ENDPOINT`, `TESSERY_BACKUP_S3_ACCESS_KEY` and
`TESSERY_BACKUP_S3_SECRET_KEY` are set. Restore with `sudo /opt/tessery/restore.sh <archive>` on the same or a new
machine after running `install.sh`. Run `backup.sh` from cron for regular backups.

### Rotating the secret key

Change `TESSERY_SECRET_KEY` when it may have leaked, or on a schedule. In `/opt/tessery`:

1. Generate a new key with `openssl rand -hex 32`. In `.env`, move the current value to
   `TESSERY_SECRET_KEY_PREVIOUS` and put the new one in `TESSERY_SECRET_KEY`.
2. `docker compose up -d`. Tessery now writes with the new key and still reads with the old one.
3. `docker compose exec server tessery-server rotate-key`. It re-encrypts every stored value in one
   transaction and prints how many it moved. If any value cannot be read it changes nothing.
4. Redeploy environments that send traces, so they get telemetry tokens made from the new key.
5. Remove `TESSERY_SECRET_KEY_PREVIOUS` from `.env` and run `docker compose up -d` again.

Take a backup first; archives made before the rotation need the old key to restore.

The root `docker-compose.yml` is for development: it builds from source, uses fixed passwords and
publishes the database ports.

## Connecting an agent

Create a token under Account, API tokens, or from a project's Agent panel, then:

```sh
claude mcp add --transport http tessery http://localhost:8080/api/mcp --header "Authorization: Bearer tessery_..."
```
