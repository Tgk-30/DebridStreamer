fn main() {
    // libmpv2-sys emits `cargo:rustc-link-lib=mpv` but no search path, so the
    // linker can't find libmpv on its own. Point it at the system/Homebrew mpv
    // (dev) or the CI-fetched copy. At runtime the bundled dylib is used instead
    // (see render_player.rs / Stage 4 packaging) — this is link-time only.
    #[cfg(target_os = "macos")]
    {
        emit_mpv_link_search();
        // CGL functions (CGLChoosePixelFormat/CGLLockContext/…) used by the
        // CAOpenGLLayer video surface live in the OpenGL framework.
        println!("cargo:rustc-link-lib=framework=OpenGL");
    }

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn emit_mpv_link_search() {
    use std::path::Path;

    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");

    // 1. Explicit override (CI can point straight at the fetched dylib dir).
    if let Ok(dir) = std::env::var("MPV_LIB_DIR") {
        if !dir.is_empty() {
            println!("cargo:rustc-link-search=native={dir}");
            return;
        }
    }

    // 2. pkg-config knows the exact libdir when mpv.pc is discoverable.
    if let Ok(out) = std::process::Command::new("pkg-config")
        .args(["--variable=libdir", "mpv"])
        .output()
    {
        if out.status.success() {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !dir.is_empty() && Path::new(&dir).exists() {
                println!("cargo:rustc-link-search=native={dir}");
                return;
            }
        }
    }

    // 3. Common Homebrew prefixes (arm64 / x86_64).
    for dir in ["/opt/homebrew/lib", "/usr/local/lib"] {
        if Path::new(dir).join("libmpv.dylib").exists()
            || Path::new(dir).join("libmpv.2.dylib").exists()
        {
            println!("cargo:rustc-link-search=native={dir}");
            return;
        }
    }

    println!(
        "cargo:warning=libmpv link path not found; set MPV_LIB_DIR or `brew install mpv`"
    );
}
