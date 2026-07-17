# Packaging & Distribution

How to build, sign, and release the DebridStreamer desktop app (the Tauri app in
`web/`). The app is a Tauri v2 project: a React/Vite frontend (`web/`) wrapped by
a Rust shell (`web/src-tauri/`).

---

## Build locally

```sh
cd web
npm install
npm run package:local
```

This builds the server bundle, builds the Vite frontend, copies both into
`web/src-tauri/resources/server`, downloads the matching Node 24 runtime for the
host platform, then compiles and bundles the Tauri shell. Local packaging uses a
temporary Tauri config override to disable updater artifact signing; CI keeps
`bundle.createUpdaterArtifacts` enabled and signs those artifacts with repo
secrets.

Outputs land under `web/src-tauri/target/release/bundle/`:

- macOS local: `bundle/macos/DebridStreamer.app` and `bundle/macos/DebridStreamer_<version>_<arch>.app.zip`
- macOS CI release: signed/notarized `.dmg` and updater artifacts from `.github/workflows/web-release.yml`
- Linux: `bundle/deb/`, `bundle/rpm/`, `bundle/appimage/`
- Windows: `bundle/msi/`, `bundle/nsis/`

To restrict the targets for a faster local run:

```sh
npm run tauri -- build --bundles app dmg --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

`npm run package:local` intentionally uses `--bundles app` on macOS and creates
the local `.app.zip` itself. That keeps local verification independent of
Finder/DMG post-processing while CI remains responsible for public signed DMGs.

`web/src-tauri/target/` is gitignored (`web/.gitignore`); build artifacts are
never committed.

Verify the local artifact after packaging:

```sh
node ../scripts/check_local_package_artifact.mjs --require-current
```

That check confirms the expected zip exists, is current against package inputs,
and prints its SHA-256. `npm run package:local` also boots the packaged server
bundle after creating the zip.

If you run `npm run tauri build` directly with the default config, the app/dmg
can be created locally but the command exits non-zero unless
`TAURI_SIGNING_PRIVATE_KEY` is set, because updater artifacts require the
private signing key.

### macOS toolchain note (this dev machine)

The default command-line toolchain on this machine is incomplete. Point
`DEVELOPER_DIR` at the Xcode-beta toolchain for the Rust/macOS build:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer npm run package:local
```

For native Swift tests, use the repo verifier from the repository root:

```sh
node scripts/check_swift_tests.mjs
```

It uses a `/private/tmp` SwiftPM scratch path to avoid Desktop/File Provider
extended attributes, links the built `VLCKit.framework` into SwiftPM's expected
test rpath, and treats only the known SwiftPM/VLCKit teardown signal as
non-fatal after assertions have passed.

---

## Local (unsigned) vs CI (signed + notarized)

### Local builds are UNSIGNED / ad-hoc

The only code-signing identity on the dev machine is an **"Apple Development"**
certificate, which is a *development* cert - it **cannot** notarize an app for
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
It fails early if the updater private key is missing, and the macOS job fails
early if any Developer ID/notarization secret is missing.

CI must also be allowed to start GitHub-hosted runners. If every workflow job
fails in a few seconds with no checkout or step logs, open the check-run
annotations; GitHub may be refusing to start jobs because account payments have
failed or the Actions spending limit needs to be increased. That is an account
billing issue, not a build failure, and it blocks public macOS / Linux /
Windows downloads until fixed.

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

If these are omitted the CI macOS job fails before packaging so it cannot upload
an unsigned / not-notarized public download.

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
> and the new public key committed to `tauri.conf.json` - and clients on old
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
2. Ensure GitHub Actions can start hosted runners and the signing secrets above
   are configured in the repo.
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
