# DebridStreamer Self-Hosting Design And Status

Design and implementation status for making DebridStreamer work as a local
desktop app, an installable PWA, and a multi-profile self-hosted server.

## Current Status

The core self-hosting path is implemented:

- `server/` Fastify backend with SQLite persistence, owner setup, login/logout,
  invites, profile CRUD, password changes, session/device revocation, admin
  health, audit log, usage summaries, and active stream visibility.
- Shared encrypted server credentials with profile-specific override support.
- Profile-scoped watchlist, history, library, folder, settings, and stream
  session APIs.
- Server-side metadata/search/discover/calendar and debrid stream resolution
  adapters for the existing frontend.
- Range-capable stream forwarding so hosted clients play through the server URL.
- Web Server Mode using the same React UI, `RemoteStore`, same-origin
  `/server-mode.js`, PWA manifest, install guides, invite links, and QR/share
  flows.
- Desktop Host Mode in Tauri that supervises the packaged server bundle and
  exposes host/share controls.
- Docker, Docker Compose, multi-arch image workflow, updater workflow, static
  downloader website, OSS docs, issue templates, and release readiness checks.

## Decision

Build one product with progressive disclosure, not multiple user-facing apps.

The repo can ship multiple artifacts, but the user should experience one
DebridStreamer:

- Desktop app: Tauri wrapper around the shared React UI, with local on-device
  storage and native playback helpers.
- Server Mode: a backend that serves the same React UI, handles login/profiles,
  stores shared data, resolves debrid streams, and proxies playback.
- PWA client: the same UI installed from a hosted Server Mode URL on iOS,
  iPadOS, Android, desktop browsers, and tablets.
- Docker/server image: the Server Mode artifact for NAS, home server, VPS,
  Raspberry Pi, and advanced users.

The app should hide or reveal setup complexity based on mode, role, and a
Simple/Advanced/Expert preference. It should not ask users to choose a separate
"easy app" versus "pro app."

## Product Goals

- One debrid-facing IP in Server Mode. Indexers and debrid providers see the
  server IP, not each viewer's home/mobile IP.
- Multiple user profiles with separate histories, watchlists, libraries, folders,
  taste profiles, assistant memories, resume points, settings, sessions, and
  optional personal credentials.
- Account self-service covers password changes and personal credential overrides
  so admins do not need to handle every secret rotation.
- Shared server/admin credentials by default, with profile-specific overrides
  when a user wants to bring their own debrid, metadata, AI, subtitle, or sync
  credentials.
- Local/on-device use remains first-class. A single user should not need to run a
  server just to use the app.
- Data-conscious profiles can hide uncached streams, cap visible quality, and
  hide oversized torrent results before resolving a stream.
- Phone/tablet access is installable and guided. iOS/iPadOS get Add to Home
  Screen instructions; Android gets install prompt support; desktop browsers get
  download/server guidance.
- Open-source friendly packaging: prebuilt desktop installers, Docker images,
  compose examples, reverse proxy examples, Tailscale guidance, Cloudflare Access
  guidance, and expert env-var/API docs.

## Still Not In Scope

- Full adaptive transcoding. Server relay alone does not eliminate viewer data
  usage: the viewer still receives video bytes from the server. The current app
  reduces accidental heavy playback with cached-only, max-quality, and max-size
  stream selection; true bitrate reduction requires adaptive HLS/transcoding.
- Public multi-tenant SaaS. This design is for self-hosting and private groups.
- A separate mobile native app. PWA first.
- Rewriting all existing desktop playback. The Tauri direct-play/mpv path remains
  useful for Local Mode and desktop users.

## User Tiers

Use one app with different setup lanes:

- New/basic user: downloads desktop app or opens an invite link. Defaults to
  Simple UI, guided install, no terminal.
- Normal user: can manage settings and profiles but never sees Docker/env/proxy
  details unless they opt in.
- Tech-savvy user: gets guided Tailscale/Cloudflare/Docker snippets with
  copy-paste commands and validation.
- Expert/admin: gets full env vars, compose, reverse-proxy examples, API docs,
  logs, diagnostics, and dangerous controls.

## Run Modes

### Local Mode

Local Mode is the current web/Tauri direction:

- React UI in `web/`.
- Tauri shell in `web/src-tauri/`.
- Local IndexedDB via `web/src/storage/DexieStore.ts`.
- OS-keychain secret backend under Tauri via `KeychainSecretStore`.
- CORS-free native HTTP through `@tauri-apps/plugin-http`.
- mpv/external player helpers through Tauri commands.

No login is required in Local Mode unless the user explicitly enables local
profile lock later.

### Server Mode

Server Mode adds an HTTP backend that:

- Serves the built React app.
- Owns auth, sessions, profiles, storage, shared settings, and credentials.
- Reuses the ported TypeScript service logic for metadata, indexers, debrid, AI,
  sync, and subtitles where practical.
- Provides a remote store API compatible with the frontend's existing `Store`
  contract.
- Resolves streams server-side and proxies stream bytes to clients with HTTP
  Range support.

Recommended first backend stack:

- Node.js 22 plus TypeScript.
- Fastify or Hono for HTTP.
- SQLite for the self-hosted database.
- `better-sqlite3` or a migration-friendly SQLite wrapper.
- `argon2id` password hashing.
- `jose` for signed tokens only where cookie sessions are insufficient.
- `undici`/native fetch for upstream HTTP.
- Zod or similar runtime validation at API boundaries.

Reason: the current web app already has TypeScript service ports for debrid,
indexers, metadata, AI, sync, and subtitles. A TypeScript server can reuse or
extract that logic faster than a Rust rewrite. Tauri can keep using Rust for
desktop-only native duties.

### Desktop Host Mode

Desktop Host Mode is a packaging layer, not a separate product:

- The Tauri app includes the Server Mode bundle, hosted PWA assets, and a Node
  runtime in release builds.
- A "Host from this desktop" setup flow starts the server locally.
- The app shows the local URL, detected LAN URL, QR code, and optional
  Tailscale/Cloudflare tunnel URL override on the same port.
- The same browser/PWA clients connect to the desktop-hosted server.

The hosted PWA is opened at the server URL instead of keeping the bundled Tauri
asset origin, so session cookies stay same-origin.

## Repository Shape

Target layout:

```text
web/                 Shared React UI and Tauri desktop shell
server/              Self-hosted HTTP backend
packages/shared/     Shared types, validation schemas, API client, service ports
docs/                User and architecture docs
deploy/              Docker Compose, reverse proxy, systemd, tunnel examples
```

Do not move everything immediately. Phase 1 can start with `server/` importing
or duplicating only the minimum shared types, then extract `packages/shared/`
when the API stabilizes.

## Data Model

All user-owned tables in Server Mode must be profile-scoped.

### Core Auth Tables

- `users`
  - `id`
  - `username`
  - `display_name`
  - `password_hash`
  - `role`: `owner`, `admin`, `member`, `restricted`
  - `created_at`
  - `last_login_at`
  - `disabled_at`

- `sessions`
  - `id`
  - `user_id`
  - `token_hash`
  - `user_agent`
  - `ip_hash`
  - `created_at`
  - `expires_at`
  - `revoked_at`

Use httpOnly, Secure, SameSite cookies for browsers/PWAs. Support reverse-proxy
header auth later for Cloudflare Access or Tailscale identity, but do not rely on
it as the only profile boundary unless explicitly configured by an admin.

### Profile-Owned Tables

Add `profile_id` to these equivalents:

- `watch_history`
- `watchlist`
- `user_library`
- `library_folders`
- `taste_events`
- `user_taste_profile`
- `assistant_memory`
- `assistant_threads`
- `profile_settings`
- `profile_sync_tokens`
- `profile_credential_overrides`
- `cached_resolutions` where the resolved direct URL is credential-specific

History and resume must remain unique per `(profile_id, media_id, episode_id)`.
Watchlist must remain unique per `(profile_id, media_id)`. Library entries must
remain unique per `(profile_id, media_id, folder_id)`.

### Shared Server Tables

These can be global:

- `server_settings`
- `server_credentials`
- `indexer_configs`
- `debrid_configs`
- `media_cache`
- `metadata_cache`
- `torrent_cache`
- `debrid_cache_state`
- `stream_sessions`
- `audit_log`
- `devices`
- `invites`

Shared metadata and cache tables prevent every profile from repeating the same
TMDB, indexer, and debrid cache work.

### Credentials

Credential resolution must be explicit:

1. If profile override exists and is enabled, use it.
2. Else if server credential exists and the profile is allowed to use it, use
   the server credential.
3. Else the feature is unavailable for that profile.

Model:

- `credential_secrets`
  - `id`
  - `provider`: `tmdb`, `omdb`, `real_debrid`, `all_debrid`, `premiumize`,
    `torbox`, `openai`, `anthropic`, `ollama`, `opensubtitles`, `trakt`
  - `scope`: `server` or `profile`
  - `profile_id`: nullable
  - `label`
  - `encrypted_value`
  - `priority`
  - `is_active`
  - `created_at`
  - `updated_at`

Encrypt secret values at rest with an app secret generated during first-run
setup and stored outside the database. Docker users can provide it via env var;
desktop-host users can store it in the OS keychain.

## Stream Proxy

Server Mode playback should not send raw debrid tokens or unrestricted links to
the client when avoidable.

Flow:

1. Client requests stream candidates for media.
2. Server queries indexers and cache state using effective credentials.
3. Server resolves the chosen stream through the effective debrid credential.
4. Server creates a short-lived `stream_session`.
5. Client plays `/api/stream/:sessionId`.
6. Server proxies upstream bytes, supports HTTP Range, forwards safe content
   headers, and refreshes the upstream direct link when needed.

Phase 1 proxy requirements:

- `GET` and `HEAD`.
- HTTP Range passthrough for seeking.
- Per-profile stream-result filters for cached-only, maximum quality, and
  maximum torrent size before candidates are returned to the client.
- Abort upstream request when the client disconnects.
- Do not cache full video files by default.
- Cache only resolution metadata/direct-link TTLs where permitted.
- Per-session expiry and profile ownership checks.
- Bandwidth accounting per profile/session.

Later:

- Adaptive bitrate/HLS transcoding with FFmpeg.
- Remux-only path where possible.
- Quality caps per profile/device.
- Server-side pre-resolution queue for watchlists.

## API Shape

Initial API namespaces:

```text
GET  /api/health
GET  /api/bootstrap

POST /api/auth/setup-owner
POST /api/auth/login
POST /api/auth/invite
POST /api/auth/logout
GET  /api/auth/session
GET  /api/auth/sessions
DELETE /api/auth/sessions/:id
POST /api/auth/change-password

GET  /api/profiles
POST /api/profiles
PATCH /api/profiles/:id
DELETE /api/profiles/:id

GET  /api/settings/effective
PUT  /api/settings/profile
PUT  /api/settings/server

GET  /api/library/watchlist
PUT  /api/library/watchlist/:mediaId
DELETE /api/library/watchlist/:mediaId
GET  /api/history
PUT  /api/history/:mediaId

GET  /api/search
GET  /api/discover
GET  /api/media/:id
GET  /api/streams/:mediaId
POST /api/streams/resolve
GET  /api/stream/:sessionId

GET  /api/admin/health
GET  /api/admin/credentials
PUT  /api/admin/credentials
GET  /api/admin/streams/active
GET  /api/admin/invites
POST /api/admin/invites
DELETE /api/admin/invites/:id
GET  /api/admin/audit-log
```

The frontend should talk through an API client instead of importing server
implementation details.

## Frontend Changes

The current frontend assumes a process-local store:

- `web/src/store/AppStore.tsx` calls `getStore()`.
- `web/src/storage/index.ts` returns a singleton Dexie store.
- `web/src/data/settings.ts` builds services directly from local settings.

Server Mode needs a backend adapter:

- `LocalStore`: existing Dexie/Tauri behavior.
- `RemoteStore`: calls `/api/*` using the logged-in profile session.
- `BackendMode`: `local`, `server`, `desktop-host-client`.
- `BackendProvider`: owns mode detection, session hydration, profile selection,
  and API base URL.
- `CredentialResolver`: moves effective credential logic out of UI settings.

Keep screens mostly unchanged by preserving the `Store` contract where possible.
Service construction changes more deeply: in Server Mode, debrid/indexer/AI
calls should go through server APIs, not direct browser calls.

## PWA And Device Install

Add:

- `web/public/manifest.webmanifest`.
- App icons copied/generated from `web/src-tauri/icons`.
- `theme_color`, `background_color`, `display: standalone`.
- Apple touch icon links in `web/index.html`.
- Service worker registration, initially app-shell caching only.
- Runtime install guide component.

Install guidance:

- iPhone/iPad Safari: show Share -> Add to Home Screen instructions.
- Android Chrome/Edge: show install prompt when available; fallback to menu
  instructions.
- Desktop browser: show install prompt where available; otherwise point to
  desktop download or Server Mode docs.
- Mac local browser: guide to desktop app download or server setup.
- Existing server link: show "Install this server as an app" after login.

The service worker must not cache credentialed stream responses.

## Onboarding

First-run setup should ask outcome-oriented questions:

- Use only on this device.
- Connect to an existing server.
- Host for my other devices.
- Host for family/friends.
- Advanced Docker/server setup.

Then set defaults:

- Simple UI for local/basic lanes.
- Advanced UI for Docker/tunnel lanes.
- Expert controls only when explicitly enabled.

Server first-run:

1. Create owner account.
2. Name the server.
3. Pick access path: LAN, Tailscale, Cloudflare Tunnel/Access, reverse proxy.
4. Configure at least one metadata provider and optional debrid provider.
5. Create invite links or additional profiles.
6. Show phone/tablet install QR code.

## Access Models

Supported:

- LAN-only.
- Tailscale.
- Cloudflare Tunnel with optional Cloudflare Access.
- Reverse proxy with HTTPS.
- Raw HTTPS for experts.

Do not encourage opening an unauthenticated HTTP port to the internet. If a user
exposes Server Mode publicly, the app must warn until HTTPS and auth are active.

Cloudflare Access and Tailscale can be outer identity layers. They should be
treated as additional protection, not a substitute for profile separation unless
admin explicitly configures trusted header login.

## Packaging

Artifacts:

- Desktop installers from Tauri, as already documented in `web/PACKAGING.md`.
- Docker image: `linux/amd64` and `linux/arm64`.
- Docker Compose examples:
  - LAN-only.
  - Tailscale sidecar.
  - Cloudflare Tunnel sidecar.
  - Caddy/Traefik reverse proxy.
- Raspberry Pi guide with ARM64 image.
- Backup/restore guide for SQLite database plus secret key.
- `.env.example` with safe defaults.

Open-source repo docs should be organized by user skill:

- `README.md`: simple explanation and download buttons.
- `docs/QUICK_START_DESKTOP.md`.
- `docs/QUICK_START_SERVER.md`.
- `docs/PHONE_TABLET_INSTALL.md`.
- `docs/DOCKER.md`.
- `docs/TAILSCALE.md`.
- `docs/CLOUDFLARE_ACCESS.md`.
- `docs/SECURITY.md`.
- `docs/ADMIN.md`.

## Security Baseline

The current implementation includes:

- Strong password hashing. Argon2id is preferred for release hardening; the
  initial Node server implementation uses a versioned built-in `scrypt` hash
  because the native Argon2 package hangs under the current local Node 25
  runtime.
- httpOnly cookie sessions.
- CSRF protection for cookie-authenticated mutations.
- In-memory rate limits on owner setup, login, invite acceptance, debrid stream
  resolution, and raw stream session creation.
- Secret encryption at rest.
- Profile-scoped authorization on every personal record.
- Admin-only server credentials.
- Session/device revocation.
- Audit log for auth, credential changes, profile changes, and stream starts.
- Secure reverse proxy headers documented and validated.
- No credential values in logs.

## Feature Ideas Worth Building Later

- Restricted/kids profile policy controls beyond the current owner/admin/member
  roles.
- Per-profile bandwidth budgets and enforcement beyond the current quality and
  file-size caps.
- Stream health details beyond the current active streams, bytes sent, HTTP
  status, and errors view, such as upstream provider and bitrate estimates.
- Shared resolution cache and watchlist pre-resolve queue.
- Requests/approval queue for restricted profiles.
- Import/export local profile to server.
- Trakt per-profile sync.
- Profile avatars and quick profile switch.
- Passkeys.
- OIDC login for experts.
- WebDAV/export backup target.
- Admin notification when debrid account health changes.
- Compatibility test page for browser playback.
- Adaptive HLS/transcoding for true bitrate reduction on limited-data clients.

## Milestone Status

### Phase 1: Server Foundation

Status: implemented.

- Add `server/` package.
- Add SQLite schema/migrations.
- Add owner setup, login/logout/session, profile CRUD.
- Add server credential storage with encryption.
- Add profile-scoped watchlist/history/library APIs.
- Add remote frontend mode and API client.
- Add server-side debrid/indexer resolution through existing TypeScript service
  logic where possible.
- Add stream session and Range-capable proxy.
- Add Dockerfile and basic Compose.
- Add tests for auth, profile isolation, credential resolution, and stream proxy
  authorization.

Acceptance:

- Two profiles can use the same server credential with separate histories.
- One profile can override a debrid credential without affecting another.
- A phone browser can log in, pick a stream, and play through the server URL.
- Debrid provider sees the server IP.
- User cannot read or mutate another profile's records.

### Phase 2: Install And Onboarding

Status: implemented for PWA/install guidance, invites, QR/share, and
server-connected clients. Tunnel automation remains documentation-first.

- PWA manifest/icons/service worker.
- iOS/iPadOS/Android install guides.
- Persona/run-mode setup wizard.
- Invite links and QR pairing.
- Desktop app "connect to server" mode.
- Docs for Tailscale and Cloudflare Access.

### Phase 3: Desktop Host Mode

Status: implemented for bundled server supervision, status, copy/share, QR, and
custom share URL support.

- Bundle and supervise Server Mode from Tauri.
- "Host from this desktop" control.
- Local URL and health checks.
- LAN URL/QR helpers.
- Optional automatic tunnel helpers where feasible.
- Backup/restore from desktop UI.

### Phase 4: Data Saver And Controls

Status: partially implemented. Cached-only, max-quality, max-size filters, usage
accounting, and active stream visibility are implemented. Adaptive
HLS/transcoding and hard bandwidth enforcement are future work.

- FFmpeg remux/transcode worker.
- Adaptive HLS output.
- Per-profile quality/bandwidth caps.
- Active stream dashboard.
- Pre-resolution queue and cache health.

### Phase 5: OSS Release Hardening

Status: implemented for CI/workflow scaffolding, docs, updater metadata checks,
Docker packaging, contribution/security docs, and issue templates. Full release
smoke on every target still depends on CI runners and signing secrets.

- Multi-arch Docker CI.
- Signed desktop releases.
- Security docs and threat model.
- Contribution guide.
- Issue templates for install/support.
- Release smoke tests for desktop, Docker, PWA, and ARM64.

## Next Hardening Steps

1. Run the GitHub Actions release, Docker, and Pages workflows with real repo
   secrets/signing keys.
2. Test the Docker image on Linux AMD64 and ARM64 hardware.
3. Add an automated end-to-end browser smoke for owner setup, invite acceptance,
   server login, and playback through `/api/stream/:id`.
4. Decide whether adaptive HLS/transcoding belongs in-process, as a worker, or
   as an optional sidecar.
5. Add backup/restore UI around the SQLite database and secret key.
