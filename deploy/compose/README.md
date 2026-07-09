# DebridStreamer Docker Compose

This runs Server Mode and serves the built PWA from the same container.

## Quick Start

### Recommended - prebuilt image (no source build)

Pulls the published multi-arch image (linux/amd64 + linux/arm64) from GHCR, so
an Ubuntu VPS / home server just needs Docker. Uses `docker-compose.ghcr.yml`.

```sh
cp .env.example .env
openssl rand -base64 32
# paste that value into DS_SERVER_SECRET_KEY in .env
docker compose -f docker-compose.ghcr.yml up -d
```

Update later with:

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

### Alternative - build from source

Uses `docker-compose.yml` to build the image locally from this checkout.

```sh
cp .env.example .env
openssl rand -base64 32
# paste that value into DS_SERVER_SECRET_KEY in .env
docker compose up -d --build
```

Open:

```text
http://localhost:43110
```

For non-Docker Ubuntu installs (native Node + systemd, or the `.deb` package),
see [`../ubuntu/README.md`](../ubuntu/README.md).

First launch creates the owner account. Phone and tablet users can open the same
URL and install it to their home screen.

Server-forwarded playback records per-profile bandwidth. Owners and admins can
review recent usage in Settings -> Server.

Owners and admins can also create invite links in Settings -> Server. Invite
links let a new user create their own password and isolated history without the
admin manually sharing credentials.

Each profile can use Settings -> Playback to show cached streams only, cap the
maximum visible quality, or hide oversized torrent results. These controls reduce
accidental heavy remote playback, but they are not server-side transcoding.

Users can change their own password and save personal credential overrides from
Settings -> Server. Admin-shared credentials remain the default when no profile
override exists.

## Tailscale

Run this compose stack on a machine already joined to your tailnet, then open:

```text
http://machine-name:43110
```

For a public or semi-public deployment, put HTTPS and an auth wall in front of
the service before sharing it outside your private network.

## Cloudflare Access

Use Cloudflare Tunnel or another reverse proxy to expose port `43110`, then set:

```env
DS_SERVER_COOKIE_SECURE=true
DS_SERVER_TRUST_PROXY=true
```

Cloudflare Access is an outer protection layer. DebridStreamer profiles and
sessions still provide the in-app boundary.

## Desktop App Connected to This Server

The easiest cross-device path is to open this server URL directly and install it
as a PWA. If you want the separately bundled desktop app to connect to this
server API, expose the server over HTTPS and allow the desktop app origin:

```env
DS_SERVER_CORS_ORIGIN=http://tauri.localhost,tauri://localhost
DS_SERVER_COOKIE_SECURE=true
DS_SERVER_COOKIE_SAMESITE=none
DS_SERVER_TRUST_PROXY=true
```

Keep `DS_SERVER_COOKIE_SAMESITE=lax` when users open the server URL directly in
their browser or as a PWA.
