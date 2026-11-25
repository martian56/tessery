# Self-hosting Tessery

This guide installs Tessery on one Linux server, keeps it up to date and takes it back to an earlier version when a
release causes trouble.

## What you need

- A Linux server you control. Tessery also builds your projects' images and runs their Docker environments on it,
  so size it for those as well.
- A domain or subdomain whose DNS A record points at the server. Caddy gets its HTTPS certificate on first start,
  so the record has to resolve before you install. If the domain is on Cloudflare, leave the record DNS only (grey
  cloud) until the certificate is issued.
- Ports 80 and 443 open to the internet. Nothing else needs to be reachable.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/martian56/tessery/main/deploy/install.sh | sudo bash
```

The script:

1. installs Docker if it's missing,
2. copies `compose.yml`, `.env.example`, `backup.sh` and `restore.sh` from [`deploy/`](../deploy) into
   `/opt/tessery`,
3. asks for the domain and writes `/opt/tessery/.env` with generated passwords and secret key,
4. pulls the images and starts Tessery behind Caddy.

Open the domain in a browser and create the instance administrator. To install somewhere other than `/opt/tessery`,
set `TESSERY_DIR`. To install without prompts, set `TESSERY_DOMAIN`:

```sh
curl -fsSL https://raw.githubusercontent.com/martian56/tessery/main/deploy/install.sh | sudo TESSERY_DOMAIN=tessery.example.com bash
```

Back up `/opt/tessery/.env` somewhere safe right away. `TESSERY_SECRET_KEY` encrypts environment secrets, git
credentials and provider credentials, and nothing can recover them without it.

Every setting is described in [`deploy/.env.example`](../deploy/.env.example). After changing `.env`, apply it with
`docker compose up -d` in `/opt/tessery`.

## Image tags

Tessery publishes two images for every release, `ghcr.io/martian56/tessery-server` and
`ghcr.io/martian56/tessery-worker`, each tagged with:

| Tag | Meaning |
|---|---|
| `0.2.0` | That exact release. It never changes once published. |
| `latest` | The newest release. Pre-releases such as `0.3.0-rc.1` are never tagged `latest`. |

`TESSERY_IMAGE_TAG` in `.env` chooses the tag. A fresh install uses `latest`. The first update from the app pins it
to the exact version it installed, so a later `docker compose up -d` or a restart of the machine never changes the
version behind your back.

## Updating

Instance administrators see an **Update to x.y.z** pill at the top of the sidebar when a newer release is out.
Everything about versions is on **Instance admin → Updates**:

- **This installation** shows the running version and the latest release. **Update** starts the update and follows
  it until the new version answers, then reloads the page.
- **Automatic updates** installs new releases by itself inside a daily window you choose, in whole UTC hours. The page
  shows the window in your own time zone too. It's off until you turn it on.
- **Roll back** takes you back to the version the last update came from.
- **History** lists every update and rollback, who started it, or whether it was automatic.
- **Changelog** shows the notes of recent releases.

### How an update works

The server can't replace its own container, so it starts a short-lived `tessery-updater` container next to it. The
updater sets `TESSERY_IMAGE_TAG` in `.env` to the new version, pulls the new `server` and `worker` images and recreates
those two containers. Postgres, Redis, RabbitMQ, the object storage and Caddy keep running, and the new server applies
any database migrations when it starts. Expect the app to be unreachable for well under a minute.

The updater's container stays after it finishes, so you can read what it did:

```sh
docker logs tessery-updater
```

The next update replaces it.

### Turning in-app updates off

In-app updates need `TESSERY_COMPOSE_DIR` in `.env`, which the installer sets to the install folder. For change
control, when every version change has to go through your own process, empty it and restart:

```sh
cd /opt/tessery
sed -i 's|^TESSERY_COMPOSE_DIR=.*|TESSERY_COMPOSE_DIR=|' .env
docker compose up -d
```

The Updates page then says updates are turned off and explains how to turn them back on, and automatic updates can't
be switched on.

### Updating by hand

Pin the version you want in `.env` and recreate the app containers:

```sh
cd /opt/tessery
sed -i 's|^TESSERY_IMAGE_TAG=.*|TESSERY_IMAGE_TAG=0.2.0|' .env
docker compose pull server worker
docker compose up -d --no-deps server worker
```

## Rolling back

From the app: **Instance admin → Updates → Roll back**. It offers the version the last update came from.

By hand: the same steps as [updating by hand](#updating-by-hand), with the older version.

A rollback replaces the app, not the data. Database migrations only run forward, so if the newer release changed the
database, the older version runs against the newer schema. Read the release notes before rolling back across a
release that mentions database changes, and when in doubt, restore the backup you took before updating instead.

## Backups

```sh
sudo /opt/tessery/backup.sh
```

writes one archive with the database, the project repositories, uploaded assets and `.env` to
`/opt/tessery/backups`, and keeps the last seven. Take one before any update you're unsure about, and run it from cron
for regular backups:

```sh
echo '15 2 * * * root /opt/tessery/backup.sh >> /var/log/tessery-backup.log 2>&1' | sudo tee /etc/cron.d/tessery-backup
```

With `TESSERY_BACKUP_S3_BUCKET`, `TESSERY_BACKUP_S3_ENDPOINT`, `TESSERY_BACKUP_S3_ACCESS_KEY` and
`TESSERY_BACKUP_S3_SECRET_KEY` set in `.env`, the script also uploads each archive to any S3-compatible bucket.

To restore, on the same machine or a new one where `install.sh` has run:

```sh
sudo /opt/tessery/restore.sh /opt/tessery/backups/tessery-<date>.tar.gz
```

## Troubleshooting

| Symptom | Check |
|---|---|
| The browser shows a certificate error | `docker compose logs caddy`. The DNS record must point at this server and ports 80 and 443 must be open. |
| The site doesn't load after an update | `docker logs tessery-updater`, then `docker compose logs server`. Roll back by hand if the new version doesn't start. |
| The Updates page says updates are turned off | `TESSERY_COMPOSE_DIR` in `.env` is empty. |
| No update shows although a release is out | The server looks at GitHub at most every ten minutes. **Check now** looks again. A `dev` build never offers updates. |
