# YAWF Stream recovery runbook

This runbook covers Server Mode owner recovery, verified SQLite backup and
restore, update rollback, and Local Mode browser or desktop recovery.

## Before you start

1. Identify the database path. Docker Compose uses
   `/data/debridstreamer.sqlite`. The Debian package uses
   `/var/lib/debridstreamer/debridstreamer.sqlite` unless its environment file
   overrides `DS_SERVER_DB_PATH`.
2. Stop Server Mode before resetting an owner or restoring a database.
3. Copy commands carefully. Never paste passwords, provider tokens, the server
   secret key, session cookies, or recovery output into a public issue.
4. Keep the same `DS_SERVER_SECRET_KEY` when restoring a database. Changing it
   makes encrypted provider credentials unreadable.

## Create a verified Server Mode backup

The backup command uses SQLite's online backup API and runs an integrity check
before reporting success.

### Docker Compose

```sh
cd deploy/compose
docker compose exec debridstreamer \
  node server/dist/index.cjs recovery backup \
  --output /data/backups/manual.sqlite
```

Copy the resulting file from the named volume to separate storage.

### Debian package or unpacked server

```sh
sudo -u debridstreamer \
  node /opt/debridstreamer/server/dist/index.cjs recovery backup \
  --output /var/lib/debridstreamer/backups/manual.sqlite
```

The command refuses to overwrite an existing file. Use a new filename for each
backup.

## Restore a verified Server Mode backup

Restore validates the input first and creates a timestamped `pre-restore`
safety backup of the current database. It then replaces the database
atomically. The `--force` flag is required so a restore cannot happen by
accident.

### Docker Compose

```sh
cd deploy/compose
docker compose stop debridstreamer
docker compose run --rm --no-deps debridstreamer \
  node server/dist/index.cjs recovery restore \
  --input /data/backups/manual.sqlite --force
docker compose up -d debridstreamer
```

### Debian package

```sh
sudo systemctl stop debridstreamer
sudo -u debridstreamer \
  node /opt/debridstreamer/server/dist/index.cjs recovery restore \
  --input /var/lib/debridstreamer/backups/manual.sqlite --force
sudo systemctl start debridstreamer
```

After restart, check `/api/health`, sign in, confirm the expected profiles, and
run the read-only provider checks in Settings.

## Recover the owner password or TOTP

Run this only on the server host. It changes the selected active owner's
password, disables TOTP for that owner, revokes all of their sessions, and adds
an audit record. The password is read from standard input and is not accepted as
a command-line argument.

### Docker Compose

```sh
cd deploy/compose
docker compose stop debridstreamer
read -s NEW_PASSWORD
printf '%s\n' "$NEW_PASSWORD" | docker compose run --rm --no-deps -T \
  debridstreamer node server/dist/index.cjs recovery reset-owner \
  --password-stdin
unset NEW_PASSWORD
docker compose up -d debridstreamer
```

### Debian package

```sh
sudo systemctl stop debridstreamer
read -s NEW_PASSWORD
printf '%s\n' "$NEW_PASSWORD" | sudo -u debridstreamer \
  node /opt/debridstreamer/server/dist/index.cjs recovery reset-owner \
  --password-stdin
unset NEW_PASSWORD
sudo systemctl start debridstreamer
```

If more than one active owner exists, add `--username OWNER` to select the
account.

## Automatic pre-upgrade snapshots

When Server Mode opens an older database with a newer schema, it first creates
an integrity-preserving snapshot beside the database:

```text
backups/pre-upgrade-v<old>-to-v<new>-<timestamp>.sqlite
```

No snapshot is created when the schema is already current or for a new empty
database. Move important snapshots to separate storage. An automatic snapshot
does not replace a regular backup schedule.

## Roll back a failed update

1. Stop the server.
2. Save the current database, logs, installed version, and redacted diagnostics.
3. Restore the newest `pre-upgrade` snapshot only if the update migrated the
   schema and the new version cannot start.
4. Reinstall the previously verified package or container image.
5. Keep the existing server secret key and data volume.
6. Start the server and verify health, login, profiles, and provider checks.

A newer database schema may be rejected by an older release. Do not bypass that
guard. Restore the matching pre-upgrade snapshot instead.

## Clean reinstall without losing data

Back up the database and the server environment file first. Reinstalling the
application files is safe only when the data directory, database, and server
secret key are preserved. For Docker, keep the named data volume. For Debian,
keep `/var/lib/debridstreamer` and
`/etc/debridstreamer/debridstreamer.env`.

## Export and restore Local Mode data

Open **Settings**, **Privacy**, then use **Export local backup**. The JSON backup
contains every local profile's non-secret settings, watchlist, history, library,
taste data, and media cache, plus the active-profile selection.

Use **Restore local backup** to verify and restore a backup. Before changing the
databases, YAWF Stream automatically downloads a `pre-restore` copy of the
current non-secret data. Existing profile locks remain in place. Profiles
created by a restore are unlocked because password hashes are intentionally
excluded; set a new local profile password after the reload.

Portable backups intentionally exclude:

- API keys, debrid tokens, profile password hashes, and other credentials
- temporary or signed stream URLs
- device-specific download paths

Reconnect providers after moving to a new device. Keep exported files private
because watch history and library data are personal even without credentials.

## What to attach to a bug report

Attach the redacted diagnostics export from **Settings**, **Help & updates**.
Include the app version, platform, package type, whether Local Mode or Server
Mode was used, the exact non-secret error message, and the recovery step that
failed. Do not attach a database or backup to a public issue.
