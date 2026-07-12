// In-window mpv player, split into a platform-agnostic core + a per-OS surface.
//
//   core.rs           - shared mpv lifecycle, event loop, commands, the
//                       `VideoSurface` trait + `PreInit` (the platform seam).
//   surface_macos.rs  - macOS render-API surface (CAOpenGLLayer).
//   surface_windows.rs - Windows wid-embed surface (mpv renders into the HWND).
//   surface_linux.rs  - Linux X11 wid-embed surface (mpv renders into the XID).
//   stub.rs           - libmpv-free error stubs for platforms without a surface
//                       yet, so the crate still links on every OS.
//
// The real (libmpv-linked) core is compiled only where a surface + libmpv linkage
// exist. `core::create_player` calls the cfg-selected `surface_pre_init()` +
// `surface_attach()`, resolved here as `super::surface_pre_init/attach`.

// ── Platforms WITH a native surface + libmpv (real player) ────────────────
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod core;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub use core::*;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub(crate) fn debug_log_startup() {
    core::rp_log("RPGEO event=app-start native-player-debug-ready=true engine=none");
}

#[cfg(target_os = "macos")]
mod surface_macos;
#[cfg(target_os = "macos")]
use surface_macos::{surface_attach, surface_pre_init};

#[cfg(target_os = "windows")]
mod surface_windows;
#[cfg(target_os = "windows")]
use surface_windows::{surface_attach, surface_pre_init};

#[cfg(target_os = "linux")]
mod surface_linux;
#[cfg(target_os = "linux")]
use surface_linux::{surface_attach, surface_pre_init};

// ── Platforms WITHOUT a surface yet: libmpv-free stubs (mobile/other). ─────
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use stub::*;
