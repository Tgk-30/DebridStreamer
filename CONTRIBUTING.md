# Contributing

DebridStreamer is moving toward a desktop app, installable PWA, and self-hosted
server from one shared codebase.

## Development Setup

Install dependencies:

```sh
cd server && npm install
cd ../web && npm install
```

Run local Server Mode:

```sh
cd server
npm run dev
```

Run the web client against that server:

```sh
cd web
VITE_DEBRIDSTREAMER_SERVER_URL=http://localhost:43110 npm run dev
```

Run the desktop app:

```sh
cd web
npm run tauri dev
```

## Verification

Before opening a PR, run the checks that match your change:

```sh
cd server && npm run typecheck && npm run build
cd web && npm run typecheck && npm test && npm run build
cargo check --manifest-path web/src-tauri/Cargo.toml
node scripts/check_release_readiness.mjs
```

Docker image builds require Docker/Buildx and are covered by
`.github/workflows/docker-image.yml`.

## Code Style

- Keep frontend changes consistent with the existing React/Tauri structure.
- Keep server APIs profile-scoped unless they are explicitly admin-only.
- Do not log API keys, debrid tokens, raw stream URLs, session cookies, or CSRF
  tokens.
- Add focused tests or direct smoke coverage for auth, profile isolation,
  credentials, stream proxying, update flows, and packaging changes.

## Release Work

Desktop releases are built by `.github/workflows/web-release.yml` and signed for
the Tauri updater. Docker images are built by `.github/workflows/docker-image.yml`.
The static downloader website is deployed by `.github/workflows/site.yml`.
