# Release, Downloads, and OTA Updates

DebridStreamer ships three public-facing artifacts:

- Desktop app bundles from the Tauri project in `web/`, including the local
  Server Mode supervisor resources.
- Server Mode Docker image from the root `Dockerfile`.
- Static download website from `website/`, deployed by GitHub Pages.

## Desktop OTA Updates

The desktop app uses `tauri-plugin-updater`.

- Runtime check: `web/src/lib/updater.ts`
- User prompt and auto-install option: `web/src/components/UpdateBanner.tsx`
- Settings toggles: Settings -> Updates
- Update endpoint: `web/src-tauri/tauri.conf.json`
- Updater artifact generation: `bundle.createUpdaterArtifacts` in
  `web/src-tauri/tauri.conf.json`
- CI release workflow: `.github/workflows/web-release.yml`

The Tauri bundler creates signed updater artifacts, and the release workflow
publishes those bundles plus `latest.json` to GitHub Releases. Installed
desktop apps read:

```text
https://github.com/Tgk-30/DebridStreamer/releases/latest/download/latest.json
```

The updater public key is committed in `tauri.conf.json`; the private key must
be stored as GitHub Actions secrets:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

macOS public releases also need Developer ID signing and notarization secrets as
listed in `web/PACKAGING.md`.

## Cutting A Desktop Release

1. Update `version` in `web/src-tauri/tauri.conf.json`.
2. Run readiness checks:

   ```sh
   node scripts/check_release_readiness.mjs
   cd server && npm run typecheck && npm run build
   cd web && npm run typecheck && npm test && npm run build
   cargo check --manifest-path web/src-tauri/Cargo.toml
   ```

3. Tag and push:

   ```sh
   git tag v0.1.0-web
   git push origin v0.1.0-web
   ```

4. Review the draft GitHub Release created by `web-release`.
5. Publish the release. The latest published release becomes the OTA target.

## Download Website

The static website lives in `website/`.

It detects macOS, Windows, and Linux in the browser, fetches the latest GitHub
Release via the public GitHub API, and points users to the best matching asset.
If the API fails, it falls back to the latest release page.

GitHub Pages deployment is handled by `.github/workflows/site.yml`.

## Public Support Files

Open-source release support files:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/install_support.yml`

## Server Mode Docker

The root `Dockerfile` builds:

- `web/dist` as the PWA client.
- `server/dist` as the API/runtime.
- A single runtime image that serves both.

`.github/workflows/docker-image.yml` publishes multi-arch images for
`linux/amd64` and `linux/arm64` to GHCR on `main`, version tags, and manual
runs. Compose examples live in `deploy/compose/`, and the Docker user guide is
`docs/DOCKER.md`.

The image name is derived from the repository in lowercase:

```text
ghcr.io/<owner>/<repo>
```

## Desktop Host Mode Packaging

The desktop app exposes Settings -> Install -> Host from this desktop. In a
release build, that card starts a local Server Mode process and opens
`http://127.0.0.1:43110`, which keeps profile/session cookies same-origin for
the hosted PWA. Other devices can use the desktop machine's LAN, Tailscale, or
tunnel address on the same port.

The host card detects a LAN URL when possible, renders a QR code, and provides
copy/share controls. Set `DEBRIDSTREAMER_DESKTOP_SHARE_URL` before launching the
desktop app to prefer a Tailscale or Cloudflare Tunnel URL in the QR/share card.

The release workflow prepares three resources before Tauri bundling:

- `server/dist/index.cjs`: bundled Server Mode entry.
- `web/dist`: hosted PWA assets copied to `resources/server/web-dist`.
- Node runtime binaries under `resources/server/node/<platform>`.

The helper scripts are:

```sh
node scripts/prepare_tauri_server_resources.mjs
node scripts/download_tauri_node_runtime.mjs darwin-arm64 darwin-x64
```

Local development can use the repo fallback after `cd server && npm run build`.
Downloaded releases use the packaged resources.
