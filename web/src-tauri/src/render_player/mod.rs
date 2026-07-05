// In-window mpv player, split into a platform-agnostic core + a per-OS surface.
//
//   core.rs           — shared mpv lifecycle, event loop, commands, the
//                       `VideoSurface` trait (the ONLY platform seam).
//   surface_macos.rs  — macOS render-API surface (CAOpenGLLayer).
//   surface_windows.rs / surface_linux.rs — added in v0.6 Phases 2/3.
//   stub.rs           — libmpv-free error stubs for platforms without a surface
//                       yet, so the crate still links on every OS.
//
// The real (libmpv-linked) core is compiled only where a surface + libmpv linkage
// exist. Adding a platform = add its `surface_*.rs`, widen the cfg below, and wire
// its libmpv link/bundle. `core::create_player` calls the cfg-selected free
// function `attach_surface()`, resolved here as `super::attach_surface`.

// ── Platforms WITH a native surface + libmpv (real player) ────────────────
#[cfg(target_os = "macos")]
mod core;
#[cfg(target_os = "macos")]
pub use core::*;

#[cfg(target_os = "macos")]
mod surface_macos;
#[cfg(target_os = "macos")]
use surface_macos::{surface_attach, surface_pre_init};

// ── Platforms WITHOUT a surface yet: libmpv-free error stubs ──────────────
#[cfg(not(target_os = "macos"))]
mod stub;
#[cfg(not(target_os = "macos"))]
pub use stub::*;
