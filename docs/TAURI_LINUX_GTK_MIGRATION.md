# Tauri Linux GTK and glib Migration

Status: accepted residual risk for v1, migration required for the Tauri 3 line.

Last verified: 2026-07-21.

## v1 decision

The current Linux desktop dependency chain does not block v1 by itself. The
repository has no direct GTK, WebKitGTK, or glib dependency and no direct use of
`glib::VariantStrIter`. These crates enter through the Tauri 2 Linux runtime.
`cargo audit --file web/src-tauri/Cargo.lock` scans 601 packages, exits
successfully, reports no vulnerability-class findings, and reports 17 allowed
warnings.

This is not a permanent acceptance. GTK3 is unmaintained and the locked glib
version has an unsound iterator implementation. Shipping v1 therefore requires
the existing Rust audit gate, clean Linux package tests, and this recorded
migration plan. A newly reported exploitable vulnerability, a failed audit, or
a Linux runtime regression reopens the v1 decision.

## Current dependency ownership

The lockfile currently resolves:

- `tauri 2.11.2`
- `tauri-runtime-wry 2.11.2`
- `wry 0.55.1`
- `webkit2gtk 2.0.2`
- `gtk 0.18.2`
- `glib 0.18.5`

`cargo tree --target all -i gtk@0.18.2` and the equivalent glib command show
that Tauri, `tauri-runtime-wry`, Wry, WebKitGTK, Tao, and Muda own the GTK3
chain. The application does not safely control those versions independently.
Forcing only GTK or glib to a different major version would split a coupled GUI
stack and is not an acceptable release fix.

The official Wry repository documents WebKitGTK and GTK3 as the current Linux
backend. Tauri maintainers have identified GTK4 and WebKitGTK 6 as Tauri 3 work,
but have also said that Tauri 3 is not close enough to delay current releases.

- [Wry platform backend](https://github.com/tauri-apps/wry)
- [Tauri 3 planning discussion](https://github.com/orgs/tauri-apps/discussions/1336)
- [GTK4 and WebKitGTK 6 tracking issue](https://github.com/tauri-apps/tauri/issues/9662)

## Recorded audit warnings

GTK3 binding maintenance warnings:

- `RUSTSEC-2024-0411`
- `RUSTSEC-2024-0412`
- `RUSTSEC-2024-0413`
- `RUSTSEC-2024-0414`
- `RUSTSEC-2024-0415`
- `RUSTSEC-2024-0416`
- `RUSTSEC-2024-0417`
- `RUSTSEC-2024-0418`
- `RUSTSEC-2024-0419`
- `RUSTSEC-2024-0420`

glib warning:

- `RUSTSEC-2024-0429`, unsound `Iterator` and `DoubleEndedIterator`
  implementations for `glib::VariantStrIter`

Other transitive maintenance warnings observed in the same audit:

- `RUSTSEC-2024-0370`
- `RUSTSEC-2025-0075`
- `RUSTSEC-2025-0080`
- `RUSTSEC-2025-0081`
- `RUSTSEC-2025-0098`
- `RUSTSEC-2025-0100`

## Migration trigger and sequence

1. Continue taking compatible Tauri 2, plugin, Wry, and WebKitGTK patch updates.
2. Review the advisory database and Tauri 3 status for every desktop release.
3. Start a dedicated migration branch when Tauri 3 reaches a release candidate
   suitable for package testing, or immediately if an exploitable advisory has
   no Tauri 2 fix.
4. Upgrade Tauri core, official plugins, Wry, and the Linux WebKitGTK backend as
   one dependency set. Do not patch GTK or glib alone.
5. Remove the accepted warning record only after the lockfile and runtime tests
   prove that the GTK3 chain is gone.

## Acceptance criteria

The migration is complete only when all of the following are observed:

- `cargo tree --target all` contains no GTK3 binding crates and no `glib 0.18`.
- `cargo audit` has no GTK3 maintenance warnings or `RUSTSEC-2024-0429`.
- Rust formatting, Clippy with warnings denied, and all Rust tests pass.
- AppImage and deb packages build and clean-launch on Ubuntu 22.04 and 24.04.
- Both Wayland and X11 sessions can start the app, open menus and dialogs, use
  the tray integration, and complete updater checks.
- The bundled server boots and the desktop app can connect to it with a clean
  profile.
- Built-in libmpv playback, resize, fullscreen, subtitle, audio-track, and
  teardown paths pass without process crashes.
- Package size, initial request count, and production bundle budgets do not
  regress beyond their recorded thresholds without an explicit review.

## Release gates until migration

- Keep `cargo audit` in CI and treat any vulnerability-class finding as a hard
  failure.
- Keep continuous Linux AppImage and deb clean-package launch tests.
- Re-run the dependency tree and audit before a public desktop release.
- Do not claim the GTK3/glib warning is fixed until the acceptance criteria are
  satisfied on actual Linux runners.
