// In-window mpv render-API player (macOS).
//
// This is the "beyond IINA" in-window video path. Instead of mpv's unreliable
// `--wid` embedding (which spawns its own window on macOS — see player.rs), we
// drive mpv's *render API* ourselves:
//
//   * Create a bare `NSView` and our own `NSOpenGLContext`, insert the view
//     BELOW the WKWebView in the (transparent) window's content view, and set
//     the context's drawable to that view.
//   * Create mpv with `vo=libmpv` and an `mpv_render_context` bound to OpenGL.
//   * A dedicated render thread owns the GL context + the render context and
//     draws whenever mpv's update callback signals a new frame (the canonical
//     libmpv render loop). All mpv/GL calls happen on that one thread; only the
//     AppKit view mutations happen on the main thread.
//
// The webview is punched transparent by the frontend while the player is up, so
// the video composited behind it shows through, with our React controls on top.
//
// Correctness invariants (see RENDER_PLAYER_PLAN.md risks):
//   * `RenderContext` is `!Send` — it is created lazily ON the render thread so
//     it is born on the thread that will only ever touch it.
//   * The `NSOpenGLContext` ownership is transferred to the render thread via
//     `Retained::into_raw`/`from_raw` (no cross-thread refcount race).
//   * mpv's render context is freed (render thread exit) BEFORE mpv itself is
//     destroyed (Player's `Arc<Mpv>` drop after the thread is joined).

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_void, CString};
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::sync::{Arc, Condvar, Mutex, OnceLock};
    use std::thread::JoinHandle;

    use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
    use libmpv2::Mpv;

    use dispatch2::DispatchQueue;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSOpenGLContext, NSOpenGLPFAAccelerated, NSOpenGLPFAAlphaSize,
        NSOpenGLPFAColorSize, NSOpenGLPFADoubleBuffer, NSOpenGLPFAOpenGLProfile, NSOpenGLPixelFormat,
        NSOpenGLPixelFormatAttribute, NSOpenGLProfileVersion3_2Core, NSView, NSWindowOrderingMode,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    use std::ptr::NonNull;
    use tauri::{AppHandle, Manager, Runtime, State, Window};

    // DIAGNOSTIC (Stage 1): append to a file — GUI-app stderr is unreliable in
    // `tauri dev`, but a file is always readable. Remove after validation.
    fn rp_log(msg: &str) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/ds-rp-debug.log")
        {
            let _ = writeln!(f, "{msg}");
        }
    }

    // ---- get_proc_address: resolve GL symbols from the system OpenGL framework.
    // Bare `fn` (no captures) as libmpv2 requires. The dlopen handle is cached.
    fn gl_get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
        static GL: OnceLock<usize> = OnceLock::new();
        let handle = *GL.get_or_init(|| {
            let path =
                CString::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").unwrap();
            unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) as usize }
        });
        if handle == 0 {
            return std::ptr::null_mut();
        }
        let cname = match CString::new(name) {
            Ok(c) => c,
            Err(_) => return std::ptr::null_mut(),
        };
        unsafe { libc::dlsym(handle as *mut c_void, cname.as_ptr()) }
    }

    // ---- Shared render-thread signalling (condvar woken by mpv's update cb).
    struct RenderShared {
        pending: Mutex<bool>,
        cv: Condvar,
        shutdown: AtomicBool,
    }
    impl RenderShared {
        fn new() -> Self {
            Self {
                pending: Mutex::new(true), // draw once on start
                cv: Condvar::new(),
                shutdown: AtomicBool::new(false),
            }
        }
        fn wake(&self) {
            if let Ok(mut p) = self.pending.lock() {
                *p = true;
                self.cv.notify_one();
            }
        }
        fn request_shutdown(&self) {
            self.shutdown.store(true, Ordering::Release);
            self.wake();
        }
    }

    /// A live in-window player. All fields are `Send` (the AppKit objects live on
    /// the render/main threads, referenced here only by raw pointer/handle).
    pub struct Player {
        mpv: Arc<Mpv>,
        shared: Arc<RenderShared>,
        render_thread: Option<JoinHandle<()>>,
        /// Raw `NSView*` of our GL view, for main-thread teardown.
        gl_view_ptr: usize,
        /// Drawable size in pixels the render thread renders at.
        dims: Arc<(AtomicI32, AtomicI32)>,
    }

    impl Player {
        fn shutdown(&mut self) {
            self.shared.request_shutdown();
            if let Some(t) = self.render_thread.take() {
                let _ = t.join();
            }
            // Remove the GL view from the hierarchy on the main thread (via GCD).
            let ptr = self.gl_view_ptr;
            DispatchQueue::main().exec_async(move || {
                if ptr != 0 {
                    let view: &NSView = unsafe { &*(ptr as *const NSView) };
                    view.removeFromSuperview();
                }
            });
        }
    }

    /// Tauri-managed: at most one in-window player at a time.
    #[derive(Default)]
    pub struct PlayerState(pub Mutex<Option<Player>>);

    // ---- Main-thread setup: build the GL view + context, spawn the render loop.
    // The content view is obtained directly from AppKit's NSApplication on the
    // main thread — this deliberately avoids Tauri's `window_handle()`, which does
    // a `dispatch_sync` to main and deadlocks when touched from the wrong thread.
    fn setup_on_main(
        mpv: Arc<Mpv>,
        shared: Arc<RenderShared>,
        dims: Arc<(AtomicI32, AtomicI32)>,
    ) -> Result<(usize, JoinHandle<()>), String> {
        rp_log("setup_on_main: start");
        let mtm = MainThreadMarker::new().ok_or("setup must run on the main thread")?;

        let ns_app = NSApplication::sharedApplication(mtm);
        let ns_window = ns_app
            .keyWindow()
            .or_else(|| ns_app.mainWindow())
            .or_else(|| ns_app.windows().firstObject())
            .ok_or("no app window")?;
        let content = ns_window.contentView().ok_or("no content view")?;
        rp_log("setup_on_main: content view ok");

        // GL view fills the content view (point coordinates; Retina refined later).
        let bounds = content.bounds();
        let w = bounds.size.width.max(1.0) as i32;
        let h = bounds.size.height.max(1.0) as i32;
        rp_log(&format!("setup_on_main: content bounds {w}x{h} (points)"));

        let frame = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(bounds.size.width, bounds.size.height),
        );
        let gl_view = unsafe { NSView::initWithFrame(mtm.alloc(), frame) };

        // Pixel format: OpenGL 3.2 core, double-buffered, hardware accelerated,
        // 24-bit color + 8-bit alpha (for compositing over the transparent page).
        let attrs: [NSOpenGLPixelFormatAttribute; 9] = [
            NSOpenGLPFAOpenGLProfile,
            NSOpenGLProfileVersion3_2Core as NSOpenGLPixelFormatAttribute,
            NSOpenGLPFADoubleBuffer,
            NSOpenGLPFAAccelerated,
            NSOpenGLPFAColorSize,
            24,
            NSOpenGLPFAAlphaSize,
            8,
            0,
        ];
        let pf = unsafe {
            NSOpenGLPixelFormat::initWithAttributes(
                mtm.alloc(),
                NonNull::new(attrs.as_ptr() as *mut NSOpenGLPixelFormatAttribute).unwrap(),
            )
        }
        .ok_or("failed to create NSOpenGLPixelFormat")?;

        let gl_context =
            NSOpenGLContext::initWithFormat_shareContext(mtm.alloc(), &pf, None)
                .ok_or("failed to create NSOpenGLContext")?;

        // Insert BELOW the webview so the transparent page reveals the video.
        content.addSubview_positioned_relativeTo(&gl_view, NSWindowOrderingMode::Below, None);
        gl_context.setView(Some(&gl_view), mtm);

        // The GL drawable is sized in BACKING pixels (Retina 2× etc.). Render mpv
        // at that size so the video fills the whole surface, not a corner.
        let backing = gl_view.convertRectToBacking(gl_view.bounds());
        let bw = (backing.size.width.max(1.0)) as i32;
        let bh = (backing.size.height.max(1.0)) as i32;
        dims.0.store(bw, Ordering::Relaxed);
        dims.1.store(bh, Ordering::Relaxed);
        rp_log(&format!(
            "setup_on_main: gl_view inserted below webview, backing {bw}x{bh}"
        ));

        let gl_view_ptr = Retained::as_ptr(&gl_view) as usize;
        // Transfer context ownership to the render thread (no refcount race).
        let ctx_ptr = Retained::into_raw(gl_context) as usize;

        // Spawn the render thread. It owns the GL context + render context.
        let t_mpv = mpv.clone();
        let t_shared = shared.clone();
        let t_dims = dims.clone();
        let handle = std::thread::Builder::new()
            .name("mpv-render".into())
            .spawn(move || render_loop(ctx_ptr, t_mpv, t_shared, t_dims))
            .map_err(|e| format!("failed to spawn render thread: {e}"))?;

        Ok((gl_view_ptr, handle))
    }

    // ---- The render thread: create the render context here (it is !Send), then
    // draw on every wake from mpv's update callback.
    fn render_loop(
        ctx_ptr: usize,
        mpv: Arc<Mpv>,
        shared: Arc<RenderShared>,
        dims: Arc<(AtomicI32, AtomicI32)>,
    ) {
        rp_log("render_loop: thread started");
        let gl_context = match unsafe { Retained::from_raw(ctx_ptr as *mut NSOpenGLContext) } {
            Some(c) => c,
            None => {
                rp_log("render_loop: FATAL null context ptr");
                return;
            }
        };
        gl_context.makeCurrentContext();
        rp_log("render_loop: made context current");

        let mpv_handle = unsafe { &mut *mpv.ctx.as_ptr() };
        let mut render = match RenderContext::new(
            mpv_handle,
            [
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams {
                    get_proc_address: gl_get_proc_address,
                    ctx: (),
                }),
            ],
        ) {
            Ok(r) => {
                rp_log("render_loop: RenderContext::new OK");
                r
            }
            Err(e) => {
                rp_log(&format!("render_loop: RenderContext::new FAILED: {e}"));
                eprintln!("[render_player] RenderContext::new failed: {e}");
                return;
            }
        };

        let cb_shared = shared.clone();
        render.set_update_callback(move || cb_shared.wake());

        // DIAGNOSTIC (Stage 1): resolve glClearColor/glClear so we can paint the
        // GL view a solid colour before mpv draws. A visible magenta rectangle
        // proves the GL view is composited in-window even before any video frame.
        let gl_clear_color: Option<unsafe extern "C" fn(f32, f32, f32, f32)> = {
            let p = gl_get_proc_address(&(), "glClearColor");
            if p.is_null() {
                None
            } else {
                Some(unsafe { std::mem::transmute::<*mut c_void, _>(p) })
            }
        };
        let gl_clear: Option<unsafe extern "C" fn(u32)> = {
            let p = gl_get_proc_address(&(), "glClear");
            if p.is_null() {
                None
            } else {
                Some(unsafe { std::mem::transmute::<*mut c_void, _>(p) })
            }
        };
        const GL_COLOR_BUFFER_BIT: u32 = 0x0000_4000;
        let frame_flag = libmpv2::render::mpv_render_update::Frame as u64;
        rp_log(&format!(
            "render_loop: entering loop (glClearColor={}, glClear={})",
            gl_clear_color.is_some(),
            gl_clear.is_some()
        ));
        let mut draw_count: u64 = 0;

        loop {
            {
                let mut pending = match shared.pending.lock() {
                    Ok(p) => p,
                    Err(_) => break,
                };
                while !*pending && !shared.shutdown.load(Ordering::Acquire) {
                    pending = match shared.cv.wait(pending) {
                        Ok(p) => p,
                        Err(_) => return,
                    };
                }
                if shared.shutdown.load(Ordering::Acquire) {
                    break;
                }
                *pending = false;
            }

            // Required after each update-callback wake; also pulls the next frame.
            let flags = render.update().map(|f| f as u64).unwrap_or(0);
            let w = dims.0.load(Ordering::Relaxed).max(1);
            let h = dims.1.load(Ordering::Relaxed).max(1);
            gl_context.makeCurrentContext();
            // Paint magenta first (compositing probe), then let mpv draw over it
            // once a real frame is available.
            if let (Some(cc), Some(cl)) = (gl_clear_color, gl_clear) {
                unsafe {
                    cc(1.0, 0.0, 1.0, 1.0);
                    cl(GL_COLOR_BUFFER_BIT);
                }
            }
            let mut did_video = false;
            if flags & frame_flag != 0 {
                did_video = true;
                if let Err(e) = render.render::<()>(0, w, h, true) {
                    rp_log(&format!("render_loop: render() FAILED: {e}"));
                }
            }
            gl_context.flushBuffer();
            render.report_swap();
            draw_count += 1;
            if draw_count <= 3 || did_video && draw_count % 60 == 0 {
                rp_log(&format!(
                    "render_loop: draw #{draw_count} size={w}x{h} flags={flags} video={did_video}"
                ));
            }
        }

        // Free the render context (GL teardown) on this thread while mpv is still
        // alive, before the Player's Arc<Mpv> drops and destroys mpv.
        drop(render);
    }

    // ---- Tauri commands ----

    /// Start (or replace) the in-window player on `url`.
    #[tauri::command]
    pub fn player_load<R: Runtime>(
        app: AppHandle<R>,
        _window: Window<R>,
        _state: State<'_, PlayerState>,
        url: String,
    ) -> Result<(), String> {
        start_player(app, url)
    }

    /// The actual player-start logic, callable from the command OR from a
    /// Rust-side test autostart (see debug_autostart). Gets its state from `app`.
    pub fn start_player<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
        rp_log(&format!("start_player: called url={url}"));
        let state = app.state::<PlayerState>();
        // Tear down any existing player first.
        {
            let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
            if let Some(mut old) = guard.take() {
                old.shutdown();
            }
        }

        // Create mpv configured for the render API (vo=libmpv, SW decode for now).
        // Log each option; don't abort on a single failure so we can see which
        // one errors and still let mpv_initialize run.
        rp_log("start_player: creating mpv");
        let mpv = Mpv::with_initializer(|init| {
            for (k, v) in [
                ("vo", "libmpv"),
                ("hwdec", "no"),
                ("ytdl", "no"),
                // DIAGNOSTIC: loop the test clip so it's always on screen while
                // verifying. Removed with the rest of the Stage-1 diagnostics.
                ("loop-file", "inf"),
            ] {
                match init.set_option(k, v) {
                    Ok(()) => rp_log(&format!("start_player: set_option {k}={v} ok")),
                    Err(e) => rp_log(&format!("start_player: set_option {k}={v} ERR {e}")),
                }
            }
            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {e}"))?;
        rp_log("start_player: mpv created");
        let mpv = Arc::new(mpv);

        let shared = Arc::new(RenderShared::new());
        let dims = Arc::new((AtomicI32::new(1), AtomicI32::new(1)));

        // Build the AppKit view + GL context + render thread on the main thread.
        // The JoinHandle (Send) is returned through the channel with the view ptr.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(usize, JoinHandle<()>), String>>();
        let m2 = mpv.clone();
        let s2 = shared.clone();
        let d2 = dims.clone();
        // Hop the AppKit view/context creation onto the main thread via GCD.
        DispatchQueue::main().exec_async(move || {
            let res = setup_on_main(m2, s2, d2);
            let _ = tx.send(res);
        });

        let (gl_view_ptr, render_thread) = rx
            .recv_timeout(std::time::Duration::from_secs(8))
            .map_err(|_| "timed out setting up the video surface".to_string())??;
        let render_thread = Some(render_thread);

        // Begin playback.
        rp_log("player_load: setup complete, issuing loadfile");
        mpv.command("loadfile", &[&url])
            .map_err(|e| format!("loadfile failed: {e}"))?;
        rp_log("player_load: loadfile issued OK");

        let player = Player {
            mpv,
            shared,
            render_thread,
            gl_view_ptr,
            dims,
        };
        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        *guard = Some(player);
        Ok(())
    }

    /// Run an arbitrary mpv command (e.g. `["seek","10","absolute"]`).
    #[tauri::command]
    pub fn player_command(
        state: State<'_, PlayerState>,
        args: Vec<String>,
    ) -> Result<(), String> {
        let guard = state.0.lock().map_err(|_| "player state poisoned")?;
        let p = guard.as_ref().ok_or("no player running")?;
        let (name, rest) = args.split_first().ok_or("empty command")?;
        let rest_refs: Vec<&str> = rest.iter().map(|s| s.as_str()).collect();
        p.mpv
            .command(name, &rest_refs)
            .map_err(|e| format!("mpv command failed: {e}"))
    }

    /// Set an mpv property to a string value.
    #[tauri::command]
    pub fn player_set_property(
        state: State<'_, PlayerState>,
        name: String,
        value: String,
    ) -> Result<(), String> {
        let guard = state.0.lock().map_err(|_| "player state poisoned")?;
        let p = guard.as_ref().ok_or("no player running")?;
        p.mpv
            .set_property(&name, value.as_str())
            .map_err(|e| format!("set_property failed: {e}"))
    }

    /// Get an mpv property as a string ("" if unavailable).
    #[tauri::command]
    pub fn player_get_property(
        state: State<'_, PlayerState>,
        name: String,
    ) -> Result<String, String> {
        let guard = state.0.lock().map_err(|_| "player state poisoned")?;
        let p = guard.as_ref().ok_or("no player running")?;
        Ok(p.mpv.get_property::<String>(&name).unwrap_or_default())
    }

    /// Stop playback and tear down the player.
    #[tauri::command]
    pub fn player_destroy<R: Runtime>(
        _app: AppHandle<R>,
        state: State<'_, PlayerState>,
    ) -> Result<(), String> {
        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        if let Some(mut p) = guard.take() {
            p.shutdown();
        }
        Ok(())
    }

    /// DIAGNOSTIC (Stage 1): if `RP_TEST_URL` is set, auto-start the render player
    /// from Rust ~3s after launch — bypassing the JS harness, reload timing, and
    /// window-focus entirely — and punch the page transparent via `eval` so a
    /// screenshot proves in-window compositing. Remove after Stage 1 validation.
    pub fn debug_autostart<R: Runtime>(app: AppHandle<R>) {
        let url = match std::env::var("RP_TEST_URL") {
            Ok(u) if !u.is_empty() => u,
            _ => return,
        };
        rp_log(&format!("debug_autostart: RP_TEST_URL={url}"));
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let window = match app.get_webview_window("main") {
                Some(w) => w,
                None => {
                    rp_log("debug_autostart: no 'main' webview window");
                    return;
                }
            };
            // Punch the page transparent + hide the React UI so the video behind
            // shows through the (already transparent) window.
            let _ = window.eval(
                "document.documentElement.style.background='transparent';\
                 document.body.style.background='transparent';\
                 var r=document.getElementById('root'); if(r) r.style.visibility='hidden';",
            );
            rp_log("debug_autostart: transparency eval issued, starting player");
            if let Err(e) = start_player(app.clone(), url.clone()) {
                rp_log(&format!("debug_autostart: start_player ERROR: {e}"));
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use imp::*;

// ---- Non-macOS stub: the in-window render player is macOS-only. The crate must
// still compile for the Windows/Linux release matrix; these commands report that
// the feature is unavailable so the frontend can fall back.
#[cfg(not(target_os = "macos"))]
mod stub {
    use std::sync::Mutex;
    use tauri::{AppHandle, Runtime, State, Window};

    #[derive(Default)]
    pub struct PlayerState(pub Mutex<Option<()>>);

    #[tauri::command]
    pub fn player_load<R: Runtime>(
        _app: AppHandle<R>,
        _window: Window<R>,
        _state: State<'_, PlayerState>,
        _url: String,
    ) -> Result<(), String> {
        Err("the in-window player is only available on macOS".into())
    }

    #[tauri::command]
    pub fn player_command(_state: State<'_, PlayerState>, _args: Vec<String>) -> Result<(), String> {
        Err("the in-window player is only available on macOS".into())
    }

    #[tauri::command]
    pub fn player_set_property(
        _state: State<'_, PlayerState>,
        _name: String,
        _value: String,
    ) -> Result<(), String> {
        Err("the in-window player is only available on macOS".into())
    }

    #[tauri::command]
    pub fn player_get_property(
        _state: State<'_, PlayerState>,
        _name: String,
    ) -> Result<String, String> {
        Err("the in-window player is only available on macOS".into())
    }

    #[tauri::command]
    pub fn player_destroy<R: Runtime>(
        _app: AppHandle<R>,
        _state: State<'_, PlayerState>,
    ) -> Result<(), String> {
        Ok(())
    }

    pub fn debug_autostart<R: Runtime>(_app: AppHandle<R>) {}
}

#[cfg(not(target_os = "macos"))]
pub use stub::*;
