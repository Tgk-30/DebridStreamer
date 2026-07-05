// In-window mpv player, split into a platform-agnostic core + a per-OS surface.
//
//   core.rs           — shared mpv lifecycle, event loop, commands, the
//                       `VideoSurface` trait + `PreInit` (the platform seam).
//   surface_macos.rs  — macOS render-API surface (CAOpenGLLayer).
//   surface_windows.rs— Windows wid-embed surface (mpv renders into the HWND).
//   surface_linux.rs  — added in v0.6 Phase 3.
//   stub.rs           — libmpv-free error stubs for platforms without a surface
//                       yet, so the crate still links on every OS.
//
// The real (libmpv-linked) core is compiled only where a surface + libmpv linkage
// exist. `core::create_player` calls the cfg-selected `surface_pre_init()` +
// `surface_attach()`, resolved here as `super::surface_pre_init/attach`.

// ── Platforms WITH a native surface + libmpv (real player) ────────────────
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod core;
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use core::*;

#[cfg(target_os = "macos")]
mod surface_macos;
#[cfg(target_os = "macos")]
use surface_macos::{surface_attach, surface_pre_init};

#[cfg(target_os = "windows")]
mod surface_windows;
#[cfg(target_os = "windows")]
use surface_windows::{surface_attach, surface_pre_init};

// ── Platforms WITHOUT a surface yet (Linux until Phase 3): libmpv-free stubs ─
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use stub::*;
