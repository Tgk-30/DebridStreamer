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
node scripts/check_swift_tests.mjs
cargo check --manifest-path web/src-tauri/Cargo.toml
node scripts/check_release_readiness.mjs
node scripts/public_repo_preflight.mjs
# Before pushing more than the current branch:
node scripts/public_repo_preflight.mjs --all-refs
```

Use `node scripts/check_swift_tests.mjs` for native Swift tests instead of raw
`swift test` on this repo. The verifier builds tests into `/private/tmp`, links
the local VLCKit framework into SwiftPM's test runtime path, and only tolerates
the known SwiftPM/VLCKit teardown signal after assertions pass.

Docker image builds require Docker/Buildx and are covered by
`.github/workflows/docker-image.yml`.

## Code Style

- Keep frontend changes consistent with the existing React/Tauri structure.
- Keep server APIs profile-scoped unless they are explicitly admin-only.
- Do not log API keys, debrid tokens, raw stream URLs, session cookies, or CSRF
  tokens.
- Do not commit local assistant files, transcripts, `.env` files, or credential
  values. Run `node scripts/public_repo_preflight.mjs` before pushing the
  current branch, and `node scripts/public_repo_preflight.mjs --all-refs`
  before pushing multiple branches or tags to a public remote.
- Add focused tests or direct smoke coverage for auth, profile isolation,
  credentials, stream proxying, update flows, and packaging changes.

## Release Work

Desktop releases are built by `.github/workflows/web-release.yml` and signed for
the Tauri updater. Docker images are built by `.github/workflows/docker-image.yml`.
The static downloader website is deployed by `.github/workflows/site.yml`.
