# Packaging & Distribution

How to build, sign, and release the DebridStreamer desktop app (the Tauri app in
`web/`). The app is a Tauri v2 project: a React/Vite frontend (`web/`) wrapped by
a Rust shell (`web/src-tauri/`).

---

## Build locally

```sh
cd web
npm install
npm run tauri build
```

This runs `npm run build` (the Vite frontend build) and then compiles the Rust
shell in release mode and produces the bundles configured in
`src-tauri/tauri.conf.json` (`bundle.targets` = `app`, `dmg` on macOS).

Outputs land under `web/src-tauri/target/release/bundle/`:

- macOS: `bundle/macos/DebridStreamer.app` and `bundle/dmg/DebridStreamer_<version>_<arch>.dmg`
- Linux: `bundle/deb/`, `bundle/rpm/`, `bundle/appimage/`
- Windows: `bundle/msi/`, `bundle/nsis/`

To restrict the targets for a faster local run:

```sh
npm run tauri build -- --bundles app dmg
```

`web/src-tauri/target/` is gitignored (`web/.gitignore`); build artifacts are
never committed.

### macOS toolchain note (this dev machine)

The default command-line toolchain on this machine is incomplete. Point
`DEVELOPER_DIR` at the Xcode-beta toolchain for the Rust/macOS build:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer npm run tauri build -- --bundles app dmg
```

---

## Local (unsigned) vs CI (signed + notarized)

### Local builds are UNSIGNED / ad-hoc

The only code-signing identity on the dev machine is an **"Apple Development"**
certificate, which is a *development* cert — it **cannot** notarize an app for
distribution. So the local build is intentionally left unsigned:

- `tauri.conf.json` deliberately does **not** set a macOS `signingIdentity`.
- Do **not** pass `APPLE_SIGNING_IDENTITY` for a local build (it would trigger a
  keychain-access prompt that can hang the build).

A locally built `.app` runs fine on this machine because it has no quarantine
`com.apple.quarantine` xattr, so Gatekeeper does not block it. An **unsigned**
build distributed to *other* machines (downloaded → quarantined) **will** be
blocked by Gatekeeper. For distribution you must sign + notarize in CI.

### CI builds are signed + notarized

The release workflow (`.github/workflows/web-release.yml`) signs and notarizes
the macOS build and signs the updater artifacts, using repo secrets (below).

---

## Developer ID + notarization requirement (what you must provide)

To ship a Gatekeeper-friendly macOS build you need a **"Developer ID
Application"** certificate (NOT the "Apple Development" cert on this machine).
Create it in your Apple Developer account, then provide these repo secrets:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of your exported "Developer ID Application" `.p12` (`base64 -i cert.p12`). |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)`. |
| `APPLE_ID` | Apple ID email used for notarization. |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (appleid.apple.com → Sign-In and Security → App-Specific Passwords). |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID. |

If these are omitted the CI build still runs but the macOS artifacts are
**unsigned and not notarized**.

---

## Auto-updater & the updater keypair

The app ships `tauri-plugin-updater`. On launch (`web/src/lib/updater.ts`,
called from `App.tsx`) it checks the endpoint configured in
`tauri.conf.json` → `plugins.updater.endpoints`:

```
https://github.com/Tgk-30/DebridStreamer/releases/latest/download/latest.json
```

The release workflow publishes `latest.json` alongside the bundles. The plugin
verifies a **minisign signature** on each update against the **public key** in
`tauri.conf.json` → `plugins.updater.pubkey`, so only releases signed with the
matching private key are accepted.

Updater artifacts are explicitly enabled in `tauri.conf.json` with
`bundle.createUpdaterArtifacts: true`. Keep that set, or the desktop release can
build without the signed artifacts that `latest.json` points installed apps to.

### Updater signing secrets

The updater **private key** was generated with `tauri signer generate` and is
**not** in the repo. To let CI sign releases, add:

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The full contents of the minisign private key file (the base64 blob, not a path). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password for that key (`""` / empty if generated without one). |

> Keep the private key secret. If it is lost, a new keypair must be generated
> and the new public key committed to `tauri.conf.json` — and clients on old
> versions will not be able to auto-update across the key change.

To rotate / regenerate the keypair:

```sh
cd web
npx tauri signer generate -w /path/outside/the/repo/ds-updater.key
# Copy the printed PUBLIC key into tauri.conf.json → plugins.updater.pubkey,
# and store the private key + password as the CI secrets above.
```

---

## Cutting a release

1. Bump `version` in `web/src-tauri/tauri.conf.json` (and any other version you
   track).
2. Ensure the signing secrets above are configured in the repo.
3. Push a tag matching `v*-web`:

   ```sh
   git tag v0.1.0-web
   git push origin v0.1.0-web
   ```

   (or run the `web-release` workflow manually via **Actions → web-release →
   Run workflow**).

4. CI builds macOS / Linux / Windows bundles, signs + notarizes macOS, signs the
   updater artifacts, and uploads everything to a **draft** GitHub Release plus
   `latest.json`.
5. Review the draft release, then publish it. Once published as the *latest*
   release, installed apps pick up the update on their next launch check.
