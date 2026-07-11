// In-window mpv render-API player (macOS).
//
// The "beyond IINA" in-window video path. mpv's `--wid` embedding is dead on
// macOS (spawns its own window); instead we drive mpv's *render API* into our
// own layer-backed OpenGL surface composited BEHIND the transparent webview:
//
//   * A `CAOpenGLLayer` subclass (VideoLayer) hosts the GL surface. CoreAnimation
//     owns the context + backbuffer and calls our draw callback on its render
//     thread; we render an mpv frame into the bound FBO there. Being LAYER-BACKED,
//     it survives window occlusion/activation/Space changes — unlike a bare
//     NSOpenGLContext+NSView, which detaches (goes black) on those events.
//   * The layer is hosted in a plain NSView inserted below the WKWebView.
//   * mpv (vo=libmpv) + an `mpv_render_context` (OpenGL) drive the pixels; mpv's
//     render-update callback pokes the layer (`setNeedsDisplay`) when a new frame
//     is ready — CoreAnimation then calls our draw callback.
//
// Threading walls (all hit + solved — see memory debridstreamer-embedded-player):
//   * `RenderContext` is `!Send` → created LAZILY inside the draw callback, so it
//     is born on the CA render thread that is the only thread to touch it.
//   * AppKit view/layer setup is hopped to the main thread via GCD
//     synchronously by Tauri on the AppKit thread; render-update redraws use
//     dispatch2 after the surface exists.
//   * The content view is taken from `NSApplication` (not Tauri's window handle,
//     which dispatch_sync-deadlocks off-main).

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_void, CStr, CString};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread::JoinHandle;

    use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
    use libmpv2::{Format, Mpv};

    use dispatch2::DispatchQueue;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{
        define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
    };
    use objc2_app_kit::{NSApplication, NSView, NSWindowOrderingMode};
    use objc2_core_foundation::CFTimeInterval;
    use objc2_core_video::CVTimeStamp;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_open_gl::{
        CGLChoosePixelFormat, CGLContextObj, CGLLockContext, CGLPixelFormatAttribute,
        CGLPixelFormatObj, CGLUnlockContext,
    };
    use objc2_quartz_core::{CAAutoresizingMask, CALayer, CAOpenGLLayer};

    use serde::Deserialize;
    use serde_json::{json, Value};
    use tauri::{AppHandle, Emitter, Manager, Runtime, State};

    // GL enum constants we need (not worth a GL crate).
    const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
    const GL_VIEWPORT: u32 = 0x0BA2;
    // 3.2 Core profile value for kCGLPFAOpenGLProfile.
    const CGL_OGLP_VERSION_3_2_CORE: u32 = 0x3200;

    /// Options owned by the native renderer. Frontend-supplied values must not
    /// override these because they are required for correctness and safety.
    const FORCED_MPV_OPTIONS: &[(&str, &str)] = &[
        ("vo", "libmpv"),
        ("hwdec", "auto-copy"),
        ("load-scripts", "no"),
        ("load-auto-profiles", "no"),
        ("load-commands", "no"),
        ("load-console", "no"),
        ("load-context-menu", "no"),
        ("load-positioning", "no"),
        ("load-select", "no"),
        ("load-stats-overlay", "no"),
        ("osc", "no"),
        ("ytdl", "no"),
    ];

    fn is_forced_mpv_option(name: &str) -> bool {
        FORCED_MPV_OPTIONS.iter().any(|(forced, _)| *forced == name)
    }

    // Trace log for diagnosing the player, OFF unless `DS_MPV_DEBUG` is set (GUI-app
    // stderr is unreliable in `tauri dev`, so this appends to a file when enabled).
    fn rp_log(msg: &str) {
        use std::io::Write;
        static ON: OnceLock<bool> = OnceLock::new();
        if !*ON.get_or_init(|| std::env::var_os("DS_MPV_DEBUG").is_some()) {
            return;
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/ds-rp-debug.log")
        {
            let _ = writeln!(f, "{msg}");
        }
    }

    // ---- GL symbol resolution ------------------------------------------------
    fn gl_get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
        static GL: OnceLock<usize> = OnceLock::new();
        let handle = *GL.get_or_init(|| {
            let path = CString::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").unwrap();
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

    fn gl_fn<T: Copy>(name: &str) -> Option<T> {
        let p = gl_get_proc_address(&(), name);
        if p.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute_copy::<*mut c_void, T>(&p) })
        }
    }

    /// Read `glGetIntegerv(pname)` (single value).
    fn gl_get_int(pname: u32) -> i32 {
        type F = unsafe extern "C" fn(u32, *mut i32);
        match gl_fn::<F>("glGetIntegerv") {
            Some(f) => {
                let mut v = 0i32;
                unsafe { f(pname, &mut v) };
                v
            }
            None => 0,
        }
    }

    /// Read the current GL_VIEWPORT as (width, height) in pixels.
    fn gl_viewport_size() -> (i32, i32) {
        type F = unsafe extern "C" fn(u32, *mut i32);
        match gl_fn::<F>("glGetIntegerv") {
            Some(f) => {
                let mut v = [0i32; 4];
                unsafe { f(GL_VIEWPORT, v.as_mut_ptr()) };
                (v[2].max(1), v[3].max(1))
            }
            None => (1, 1),
        }
    }

    // ---- The layer-backed video surface -------------------------------------
    // The RenderContext is created on the CA render thread but must be FREED at
    // teardown (before mpv is destroyed) from the main thread. mpv_render_context_free
    // is thread-safe; we serialize all access with a Mutex, so the !Send wrapper is
    // sound. `dead` gates the draw callback off once teardown starts.
    struct SendRender(RenderContext);
    unsafe impl Send for SendRender {}

    /// Send-safe state shared with mpv's render-update callback. The callback
    /// must never capture or dereference an Objective-C object off-main: it can
    /// run concurrently with `mpv_render_context_free` during teardown.
    struct RenderCallbackState {
        layer_ptr: AtomicUsize,
        dead: AtomicBool,
        update_count: AtomicU64,
    }

    struct VideoLayerIvars {
        mpv: Arc<Mpv>,
        render: Mutex<Option<SendRender>>,
        callback: Arc<RenderCallbackState>,
        draw_count: AtomicU64,
    }

    define_class!(
        #[unsafe(super(CAOpenGLLayer))]
        #[name = "DSVideoLayer"]
        #[ivars = VideoLayerIvars]
        struct VideoLayer;

        impl VideoLayer {
            // Provide a 3.2-core, accelerated pixel format for mpv's GL renderer.
            #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
            fn copy_cgl_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
                let attribs = [
                    CGLPixelFormatAttribute::CGLPFAAccelerated,
                    CGLPixelFormatAttribute::CGLPFAOpenGLProfile,
                    CGLPixelFormatAttribute(CGL_OGLP_VERSION_3_2_CORE),
                    CGLPixelFormatAttribute(0),
                ];
                let mut pf: CGLPixelFormatObj = std::ptr::null_mut();
                let mut n: i32 = 0;
                unsafe {
                    CGLChoosePixelFormat(
                        NonNull::new(attribs.as_ptr() as *mut CGLPixelFormatAttribute).unwrap(),
                        NonNull::new(&mut pf).unwrap(),
                        NonNull::new(&mut n).unwrap(),
                    );
                }
                pf
            }

            #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
            fn can_draw(
                &self,
                _ctx: CGLContextObj,
                _pf: CGLPixelFormatObj,
                _t: CFTimeInterval,
                _ts: *const CVTimeStamp,
            ) -> bool {
                true
            }

            // Disable ALL implicit animations on this layer. As a sublayer, CA would
            // otherwise animate every autoresize geometry change (~0.25s), so the
            // video lags behind the window edge during a drag-resize ("not locked
            // to the sides"). Returning NSNull means "no action" for every key.
            #[unsafe(method(actionForKey:))]
            fn action_for_key(&self, _key: *const AnyObject) -> *mut AnyObject {
                unsafe { msg_send![objc2::class!(NSNull), null] }
            }

            #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
            fn draw(
                &self,
                ctx: CGLContextObj,
                pf: CGLPixelFormatObj,
                t: CFTimeInterval,
                ts: *const CVTimeStamp,
            ) {
                unsafe { CGLLockContext(ctx) };

                let ivars = self.ivars();
                // Teardown has started — do not touch mpv/render at all.
                if ivars.callback.dead.load(Ordering::Acquire) {
                    unsafe { CGLUnlockContext(ctx) };
                    unsafe {
                        let _: () = msg_send![super(self),
                            drawInCGLContext: ctx, pixelFormat: pf,
                            forLayerTime: t, displayTime: ts];
                    }
                    return;
                }

                let mut render_slot = ivars.render.lock().unwrap();
                if render_slot.is_none() {
                    // Re-check dead now that we hold the lock (teardown may have run
                    // between the check above and acquiring the lock).
                    if ivars.callback.dead.load(Ordering::Acquire) {
                        drop(render_slot);
                        unsafe { CGLUnlockContext(ctx) };
                        return;
                    }
                    let mpv_handle = unsafe { &mut *ivars.mpv.ctx.as_ptr() };
                    match RenderContext::new(
                        mpv_handle,
                        [
                            RenderParam::ApiType(RenderParamApiType::OpenGl),
                            RenderParam::InitParams(OpenGLInitParams {
                                get_proc_address: gl_get_proc_address,
                                ctx: (),
                            }),
                        ],
                    ) {
                        Ok(mut rc) => {
                            // When mpv has a new frame, poke the layer to redraw
                            // (on the main thread — CALayer.setNeedsDisplay).
                            // mpv may invoke this callback while the render context
                            // is being freed. Capture only send-safe state here; a
                            // raw VideoLayer pointer caused a reproducible UAF.
                            let callback = ivars.callback.clone();
                            rc.set_update_callback(move || {
                                if callback.dead.load(Ordering::Acquire) {
                                    return;
                                }
                                let update = callback
                                    .update_count
                                    .fetch_add(1, Ordering::Relaxed)
                                    + 1;
                                if update <= 3 {
                                    rp_log(&format!("VideoLayer.update #{update}"));
                                }
                                let redraw = callback.clone();
                                DispatchQueue::main().exec_async(move || {
                                    // Teardown and this closure both serialize on
                                    // the main queue. Re-check the flag because the
                                    // redraw may have been queued before teardown.
                                    if redraw.dead.load(Ordering::Acquire) {
                                        return;
                                    }
                                    let ptr = redraw.layer_ptr.load(Ordering::Acquire);
                                    if ptr != 0 {
                                        let layer: &VideoLayer =
                                            unsafe { &*(ptr as *const VideoLayer) };
                                        layer.setNeedsDisplay();
                                    }
                                });
                            });
                            rp_log("VideoLayer.draw: RenderContext created");
                            *render_slot = Some(SendRender(rc));
                        }
                        Err(e) => rp_log(&format!("VideoLayer.draw: RenderContext failed: {e}")),
                    }
                }

                // FBO 0-relative; w/h are the layer's drawable size in pixels.
                let fbo = gl_get_int(GL_FRAMEBUFFER_BINDING);
                let (w, h) = gl_viewport_size();
                if let Some(sr) = render_slot.as_ref() {
                    if let Err(e) = sr.0.render::<()>(fbo, w, h, true) {
                        rp_log(&format!("VideoLayer.draw: render failed: {e}"));
                    } else {
                        let draw = ivars.draw_count.fetch_add(1, Ordering::Relaxed) + 1;
                        if draw <= 5 {
                            rp_log(&format!("VideoLayer.draw #{draw} ({w}x{h})"));
                        }
                    }
                }
                drop(render_slot);
                unsafe { CGLUnlockContext(ctx) };
                // Let CAOpenGLLayer's default implementation flush the context.
                unsafe {
                    let _: () = msg_send![super(self),
                        drawInCGLContext: ctx,
                        pixelFormat: pf,
                        forLayerTime: t,
                        displayTime: ts];
                }
            }
        }
    );

    impl VideoLayer {
        fn new(mpv: Arc<Mpv>) -> Retained<Self> {
            let callback = Arc::new(RenderCallbackState {
                layer_ptr: AtomicUsize::new(0),
                dead: AtomicBool::new(false),
                update_count: AtomicU64::new(0),
            });
            let this = Self::alloc().set_ivars(VideoLayerIvars {
                mpv,
                render: Mutex::new(None),
                callback: callback.clone(),
                draw_count: AtomicU64::new(0),
            });
            let layer: Retained<Self> = unsafe { msg_send![super(this), init] };
            callback.layer_ptr.store(
                Retained::as_ptr(&layer) as usize,
                Ordering::Release,
            );
            layer
        }
    }

    // ---- Host view: redraws the video layer on every resize -----------------
    // The video layer autoresizes to fill this view, but CAOpenGLLayer only
    // reallocates its GL drawable + re-renders when explicitly asked. Overriding
    // setFrameSize (called by AppKit on every resize step) to poke the layer makes
    // the video re-render at the new native resolution — even while paused/ended —
    // instead of stretching a stale texture.
    struct HostIvars {
        layer: Retained<VideoLayer>,
    }

    define_class!(
        #[unsafe(super(NSView))]
        #[name = "DSVideoHostView"]
        #[ivars = HostIvars]
        #[thread_kind = MainThreadOnly]
        struct HostView;

        impl HostView {
            #[unsafe(method(setFrameSize:))]
            fn set_frame_size(&self, size: NSSize) {
                unsafe {
                    let _: () = msg_send![super(self), setFrameSize: size];
                }
                let layer = &self.ivars().layer;
                // Resize the layer to the view + force CAOpenGLLayer to reallocate
                // its GL drawable at the new size (a plain setNeedsDisplay does not
                // reliably grow it). Wrapped so the geometry change doesn't animate.
                let b = self.bounds();
                layer.setFrame(b);
                unsafe {
                    layer.setBounds(objc2_foundation::NSRect::new(
                        objc2_foundation::NSPoint::new(0.0, 0.0),
                        b.size,
                    ));
                };
                unsafe { layer.display() };
            }
        }
    );

    impl HostView {
        fn new(mtm: MainThreadMarker, frame: NSRect, layer: Retained<VideoLayer>) -> Retained<Self> {
            let this = mtm.alloc::<HostView>().set_ivars(HostIvars { layer });
            unsafe { msg_send![super(this), initWithFrame: frame] }
        }
    }

    /// A live in-window player. Fields are Send (AppKit objects referenced only by
    /// raw pointer / retained by the view hierarchy).
    pub struct Player {
        mpv: Arc<Mpv>,
        /// Raw `NSView*` of the layer host, for main-thread teardown.
        host_view_ptr: usize,
        /// Raw `VideoLayer*`, for freeing its render context before mpv dies.
        layer_ptr: usize,
        /// Signals the mpv event thread to stop.
        event_stop: Arc<AtomicBool>,
        event_thread: Option<JoinHandle<()>>,
    }

    impl Player {
        fn shutdown(&mut self) {
            self.event_stop.store(true, Ordering::Release);
            if let Some(t) = self.event_thread.take() {
                let _ = t.join();
            }
            let host = self.host_view_ptr;
            let layer = self.layer_ptr;
            // ORDERED teardown, SYNCHRONOUS on the main thread: mark the layer dead
            // (draw callback becomes a no-op), remove the host view (CA stops
            // drawing), then FREE the mpv render context. This must complete before
            // `self.mpv` (Arc) drops and destroys mpv — freeing the render context
            // after mpv is destroyed is a use-after-free (the "back button crashes"
            // bug). Main-thread commands tear down inline; defensive off-main
            // callers use exec_sync to preserve the same ordering.
            let teardown = move || {
                if layer != 0 {
                    let l: &VideoLayer = unsafe { &*(layer as *const VideoLayer) };
                    l.ivars().callback.dead.store(true, Ordering::Release);
                    // Free mpv_render_context while the host hierarchy still
                    // retains the layer. Dropping it unregisters/waits for the
                    // update callback, which now touches only send-safe state.
                    // Removing the host first released the final Objective-C
                    // owner and left both this code and the old `vo` callback
                    // with dangling raw pointers.
                    drop(l.ivars().render.lock().unwrap().take());
                    if host != 0 {
                        let v: &NSView = unsafe { &*(host as *const NSView) };
                        v.removeFromSuperview();
                    }
                } else if host != 0 {
                    let v: &NSView = unsafe { &*(host as *const NSView) };
                    v.removeFromSuperview();
                }
            };
            // Synchronous Tauri player commands run on AppKit's main thread.
            // Tear down directly in that case; dispatch_sync to the queue we are
            // already on would deadlock. Keep the off-main path for defensive use
            // by debug tooling or a future non-command caller.
            if MainThreadMarker::new().is_some() {
                teardown();
            } else {
                DispatchQueue::main().exec_sync(teardown);
            }
        }
    }

    /// One property to observe (from the JS `MpvConfig.observedProperties`).
    #[derive(Deserialize)]
    pub struct ObserveSpec {
        pub name: String,
        /// "flag" | "double" | "int64" | "string"
        pub format: String,
    }

    // ---- mpv event loop → webview events ------------------------------------
    // Uses raw libmpv2-sys `mpv_wait_event` (libmpv2's safe wrapper panics on a
    // MPV_FORMAT_NONE property change, which happens routinely when a property
    // becomes unavailable). Emits `player-event` = { name, data } to the webview.
    fn spawn_event_thread<R: Runtime>(
        app: AppHandle<R>,
        mpv: Arc<Mpv>,
        observed: Vec<ObserveSpec>,
        stop: Arc<AtomicBool>,
    ) -> JoinHandle<()> {
        std::thread::spawn(move || {
            // The primary handle already has its own event queue and libmpv's
            // client API is thread-safe. Do not create a secondary client here:
            // libmpv2 5.0.3 wraps a possibly-null mpv_create_client result with
            // NonNull::new_unchecked, which aborts the process under a rapid
            // create/destroy race instead of returning an error.
            if stop.load(Ordering::Acquire) {
                return;
            }
            for (i, spec) in observed.iter().enumerate() {
                let fmt = match spec.format.as_str() {
                    "flag" => Format::Flag,
                    "double" => Format::Double,
                    "int64" => Format::Int64,
                    _ => Format::String,
                };
                let _ = mpv.observe_property(&spec.name, fmt, i as u64);
            }
            let ctx = mpv.ctx.as_ptr();
            let mut property_events = 0u64;
            while !stop.load(Ordering::Acquire) {
                let ev = unsafe { &*libmpv2_sys::mpv_wait_event(ctx, 0.25) };
                match ev.event_id {
                    libmpv2_sys::mpv_event_id_MPV_EVENT_NONE => {}
                    libmpv2_sys::mpv_event_id_MPV_EVENT_SHUTDOWN => break,
                    libmpv2_sys::mpv_event_id_MPV_EVENT_END_FILE => {
                        let ef = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_end_file) };
                        rp_log(&format!(
                            "event thread: END_FILE reason={} error={}",
                            ef.reason, ef.error
                        ));
                    }
                    libmpv2_sys::mpv_event_id_MPV_EVENT_PROPERTY_CHANGE => {
                        let prop = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_property) };
                        if prop.name.is_null() {
                            continue;
                        }
                        let name = unsafe { CStr::from_ptr(prop.name) }
                            .to_string_lossy()
                            .into_owned();
                        let data = unsafe { prop_data_to_json(prop.format, prop.data) };
                        property_events += 1;
                        if property_events <= 3 {
                            rp_log(&format!("event thread: property {name}"));
                        }
                        let _ = app.emit("player-event", json!({ "name": name, "data": data }));
                    }
                    _ => {}
                }
            }
            rp_log("event thread: stopped");
        })
    }

    unsafe fn prop_data_to_json(format: libmpv2_sys::mpv_format, data: *mut c_void) -> Value {
        if data.is_null() {
            return Value::Null;
        }
        match format {
            libmpv2_sys::mpv_format_MPV_FORMAT_FLAG => json!(*(data as *mut i32) != 0),
            libmpv2_sys::mpv_format_MPV_FORMAT_INT64 => json!(*(data as *mut i64)),
            libmpv2_sys::mpv_format_MPV_FORMAT_DOUBLE => json!(*(data as *mut f64)),
            libmpv2_sys::mpv_format_MPV_FORMAT_STRING
            | libmpv2_sys::mpv_format_MPV_FORMAT_OSD_STRING => {
                let s = *(data as *mut *mut std::os::raw::c_char);
                if s.is_null() {
                    Value::Null
                } else {
                    json!(CStr::from_ptr(s).to_string_lossy().into_owned())
                }
            }
            _ => Value::Null,
        }
    }

    /// Tauri-managed: at most one in-window player at a time.
    #[derive(Default)]
    pub struct PlayerState(pub Mutex<Option<Player>>);

    // ---- Main-thread surface setup ------------------------------------------
    /// Returns (host_view_ptr, layer_ptr).
    fn setup_on_main(mpv: Arc<Mpv>) -> Result<(usize, usize), String> {
        rp_log("setup_on_main: start");
        let mtm = MainThreadMarker::new().ok_or("setup must run on the main thread")?;

        let ns_app = NSApplication::sharedApplication(mtm);
        let ns_window = ns_app
            .keyWindow()
            .or_else(|| ns_app.mainWindow())
            .or_else(|| ns_app.windows().firstObject())
            .ok_or("no app window")?;
        let content = ns_window.contentView().ok_or("no content view")?;
        let backing_scale = ns_window.backingScaleFactor();
        let bounds = content.bounds();
        rp_log(&format!(
            "setup_on_main: content {}x{} scale {}",
            bounds.size.width as i32, bounds.size.height as i32, backing_scale
        ));

        // Host view (layer-hosting) filling the content view.
        let frame = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(bounds.size.width, bounds.size.height),
        );
        let layer = VideoLayer::new(mpv);
        unsafe { layer.setContentsScale(backing_scale) };
        // Draw only when there's a new frame (mpv's update callback pokes
        // setNeedsDisplay) or the bounds change — not 60fps continuously. This also
        // makes CA reallocate the GL drawable to the new size on resize, so the
        // video always renders at native resolution instead of a stretched texture.
        layer.setAsynchronous(false);
        unsafe { layer.setNeedsDisplayOnBoundsChange(true) };
        layer.setAutoresizingMask(
            CAAutoresizingMask::LayerWidthSizable | CAAutoresizingMask::LayerHeightSizable,
        );

        // Layer-BACKED host that re-renders the video layer on every resize step.
        let host = HostView::new(mtm, frame, layer.clone());
        host.setWantsLayer(true);
        layer.setFrame(host.bounds());

        // Add the video layer as a sublayer of the host's backing layer.
        let backing: *mut AnyObject = unsafe { msg_send![&*host, layer] };
        if !backing.is_null() {
            let sublayer: &CALayer = &layer;
            unsafe {
                let _: () = msg_send![backing, addSublayer: sublayer];
            }
        }

        // Insert BELOW the webview so the transparent page reveals the video with
        // the React controls composited on top.
        content.addSubview_positioned_relativeTo(&host, NSWindowOrderingMode::Below, None);
        // Autoresize the host with the content view (wry may leave this off).
        unsafe {
            content.setAutoresizesSubviews(true);
            host.setAutoresizingMask(
                objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable
                    | objc2_app_kit::NSAutoresizingMaskOptions::ViewHeightSizable,
            );
        }

        // Ask Core Animation for its first draw now. Some macOS versions complete
        // it immediately; others do it on the next event-loop turn. `loadfile`
        // waits off-main for the render slot below, so both behaviours are safe.
        layer.display();
        rp_log(&format!(
            "setup_on_main: layer host inserted below webview; render_ready={}",
            layer.ivars().render.lock().map(|g| g.is_some()).unwrap_or(false)
        ));
        Ok((
            Retained::as_ptr(&host) as usize,
            Retained::as_ptr(&layer) as usize,
        ))
    }

    // ---- Player creation (mpv + surface + event thread; NO loadfile) ---------
    pub fn create_player<R: Runtime>(
        app: AppHandle<R>,
        options: std::collections::HashMap<String, String>,
        observed: Vec<ObserveSpec>,
    ) -> Result<(), String> {
        let state = app.state::<PlayerState>();
        {
            let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
            if let Some(mut old) = guard.take() {
                old.shutdown();
            }
        }

        let mpv = Mpv::with_initializer(|init| {
            // The render API requires vo=libmpv. Copy-mode VideoToolbox works with
            // the OpenGL render API and safely falls back to software decoding.
            // The app drives mpv entirely through libmpv and does not use mpv's
            // Lua scripts. Homebrew's arm64 mpv bundles LuaJIT; on newer macOS,
            // Hardened Runtime rejects the executable pages LuaJIT creates while
            // loading built-ins such as stats/console and kills the signed app
            // with CODESIGNING/Invalid Page. `load-scripts=no` only disables user
            // scripts in mpv 0.41, so every built-in script switch must be off.
            for &(name, value) in FORCED_MPV_OPTIONS {
                init.set_option(name, value)?;
            }
            for (k, v) in &options {
                if is_forced_mpv_option(k) {
                    continue;
                }
                if let Err(e) = init.set_option(k.as_str(), v.as_str()) {
                    rp_log(&format!("create_player: set_option {k}={v} ERR {e}"));
                }
            }
            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {e}"))?;
        let mpv = Arc::new(mpv);
        rp_log("create_player: mpv created");

        // `player_init` is intentionally synchronous, so Tauri invokes this on
        // the AppKit thread. Build the native surface directly there instead of
        // sending a closure across a queue and blocking on a channel. The queued
        // version could remain undrained on another Mac and time out/crash.
        let (host_view_ptr, layer_ptr) = setup_on_main(mpv.clone())?;
        let event_stop = Arc::new(AtomicBool::new(false));
        let event_thread = Some(spawn_event_thread(
            app.clone(),
            mpv.clone(),
            observed,
            event_stop.clone(),
        ));

        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        *guard = Some(Player {
            mpv,
            host_view_ptr,
            layer_ptr,
            event_stop,
            event_thread,
        });
        rp_log("create_player: ready");
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::is_forced_mpv_option;

        #[test]
        fn frontend_cannot_override_native_player_safety_options() {
            for &(name, _) in super::FORCED_MPV_OPTIONS {
                assert!(is_forced_mpv_option(name), "{name} must stay forced");
            }
            assert!(!is_forced_mpv_option("cache"));
        }
    }

    fn command_when_ready<R: Runtime>(app: &AppHandle<R>, args: &[String]) -> Result<(), String> {
        let state = app.state::<PlayerState>();
        // Keep the state guard for the bounded wait so rapid close/reopen cannot
        // destroy the layer behind this raw pointer.
        let guard = state.0.lock().map_err(|_| "player state poisoned")?;
        let player = guard.as_ref().ok_or("no player running")?;
        let (name, rest) = args.split_first().ok_or("empty command")?;

        if name == "loadfile" {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                let layer: &VideoLayer = unsafe { &*(player.layer_ptr as *const VideoLayer) };
                let ready = layer
                    .ivars()
                    .render
                    .lock()
                    .map(|slot| slot.is_some())
                    .unwrap_or(false);
                if ready {
                    rp_log("loadfile: render context ready");
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    return Err("timed out creating the video render context".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
        }

        let rest_refs: Vec<&str> = rest.iter().map(String::as_str).collect();
        let result = player
            .mpv
            .command(name, &rest_refs)
            .map_err(|e| format!("mpv command failed: {e}"));
        rp_log(&format!("cmd {name} {rest:?} -> {result:?}"));
        result
    }

    fn with_player<T>(
        state: &State<'_, PlayerState>,
        f: impl FnOnce(&Player) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = state.0.lock().map_err(|_| "player state poisoned")?;
        let p = guard.as_ref().ok_or("no player running")?;
        f(p)
    }

    /// Debug-only end-to-end smoke hook. It exercises the same mpv creation,
    /// native surface, render context, and loadfile path as the frontend without
    /// requiring a configured debrid account.
    #[cfg(debug_assertions)]
    pub fn debug_smoke_load<R: Runtime>(app: AppHandle<R>, url: &str) -> Result<(), String> {
        // Mirror EmbeddedPlayer's production configuration and observations. An
        // empty setup misses failures in option parsing and the event bridge.
        let options = std::collections::HashMap::from([
            ("vo".to_string(), "gpu-next".to_string()),
            ("hwdec".to_string(), "auto-safe".to_string()),
            ("keep-open".to_string(), "yes".to_string()),
            ("cache".to_string(), "yes".to_string()),
            ("demuxer-max-bytes".to_string(), "150MiB".to_string()),
            ("sub-auto".to_string(), "fuzzy".to_string()),
            ("sub-font-size".to_string(), "44".to_string()),
            ("terminal".to_string(), "no".to_string()),
        ]);
        let observed = [
            ("pause", "flag"),
            ("time-pos", "double"),
            ("duration", "double"),
            ("core-idle", "flag"),
            ("volume", "double"),
            ("speed", "double"),
            ("demuxer-cache-time", "double"),
            ("aid", "string"),
            ("sid", "string"),
            ("eof-reached", "flag"),
        ]
        .into_iter()
        .map(|(name, format)| ObserveSpec {
            name: name.to_string(),
            format: format.to_string(),
        })
        .collect();
        create_player(app.clone(), options, observed)?;
        let args = vec!["loadfile".to_string(), url.to_string()];
        std::thread::spawn(move || {
            match command_when_ready(&app, &args) {
                Ok(()) => rp_log("DS_PLAYER_SMOKE loadfile succeeded"),
                Err(error) => rp_log(&format!("DS_PLAYER_SMOKE loadfile failed: {error}")),
            }
            if let Ok(delay) = std::env::var("DS_PLAYER_SMOKE_DESTROY_MS") {
                if let Ok(delay) = delay.parse::<u64>() {
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                    match player_destroy(app.clone()) {
                        Ok(()) => rp_log("DS_PLAYER_SMOKE destroy succeeded"),
                        Err(error) => rp_log(&format!("DS_PLAYER_SMOKE destroy failed: {error}")),
                    }
                    if std::env::var_os("DS_PLAYER_SMOKE_EXIT").is_some() {
                        app.exit(0);
                    }
                }
            }
        });
        Ok(())
    }

    // ---- Tauri commands ------------------------------------------------------

    /// Create the player (mpv + layer surface + event thread). Loading a file is a
    /// separate `player_command("loadfile", [url])`.
    ///
    /// Deliberately synchronous: Tauri runs sync commands on the main thread,
    /// which is exactly where the AppKit/CAOpenGLLayer surface must be created.
    #[tauri::command]
    pub fn player_init<R: Runtime>(
        app: AppHandle<R>,
        options: std::collections::HashMap<String, String>,
        observed: Vec<ObserveSpec>,
    ) -> Result<(), String> {
        create_player(app, options, observed)
    }

    #[tauri::command]
    pub async fn player_command<R: Runtime>(
        app: AppHandle<R>,
        args: Vec<String>,
    ) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || command_when_ready(&app, &args))
            .await
            .map_err(|e| format!("player command task failed: {e}"))?
    }

    #[tauri::command]
    pub fn player_set_property(
        state: State<'_, PlayerState>,
        name: String,
        value: String,
    ) -> Result<(), String> {
        with_player(&state, |p| {
            let r = p
                .mpv
                .set_property(&name, value.as_str())
                .map_err(|e| format!("set_property failed: {e}"));
            rp_log(&format!("set {name}={value} -> {r:?}"));
            r
        })
    }

    /// Get a property as JSON. `track-list`/`chapter-list` are assembled from mpv
    /// sub-properties (avoids raw mpv_node FFI); everything else returns a string.
    #[tauri::command]
    pub fn player_get_property(
        state: State<'_, PlayerState>,
        name: String,
    ) -> Result<Value, String> {
        with_player(&state, |p| match name.as_str() {
            "track-list" => Ok(build_track_list(&p.mpv)),
            "chapter-list" => Ok(build_chapter_list(&p.mpv)),
            _ => Ok(json!(p.mpv.get_property::<String>(&name).unwrap_or_default())),
        })
    }

    /// Reserve a fraction of the bottom of the video for the control bar so the
    /// controls never cover the picture (mpv `video-margin-ratio-bottom`).
    #[tauri::command]
    pub fn player_set_video_margin(
        state: State<'_, PlayerState>,
        bottom: f64,
    ) -> Result<(), String> {
        with_player(&state, |p| {
            let r = p
                .mpv
                .set_property("video-margin-ratio-bottom", bottom)
                .map_err(|e| format!("set video margin failed: {e}"));
            rp_log(&format!("video-margin {bottom} -> {r:?}"));
            r
        })
    }

    #[tauri::command]
    pub fn player_destroy<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
        let state = app.state::<PlayerState>();
        let taken = {
            let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
            guard.take()
        };
        if let Some(mut p) = taken {
            p.shutdown();
        }
        Ok(())
    }

    fn build_track_list(mpv: &Mpv) -> Value {
        let count = mpv.get_property::<i64>("track-list/count").unwrap_or(0);
        let mut arr = Vec::new();
        for i in 0..count {
            let s = |p: &str| mpv.get_property::<String>(&format!("track-list/{i}/{p}")).ok();
            let b = |p: &str| {
                mpv.get_property::<bool>(&format!("track-list/{i}/{p}"))
                    .unwrap_or(false)
            };
            arr.push(json!({
                "id": mpv.get_property::<i64>(&format!("track-list/{i}/id")).ok(),
                "type": s("type"),
                "title": s("title"),
                "lang": s("lang"),
                "selected": b("selected"),
                "codec": s("codec"),
                "external": b("external"),
            }));
        }
        Value::Array(arr)
    }

    fn build_chapter_list(mpv: &Mpv) -> Value {
        let count = mpv.get_property::<i64>("chapter-list/count").unwrap_or(0);
        let mut arr = Vec::new();
        for i in 0..count {
            arr.push(json!({
                "title": mpv.get_property::<String>(&format!("chapter-list/{i}/title")).unwrap_or_default(),
                "time": mpv.get_property::<f64>(&format!("chapter-list/{i}/time")).unwrap_or(0.0),
            }));
        }
        Value::Array(arr)
    }

}

#[cfg(target_os = "macos")]
pub use imp::*;

// ---- Non-macOS stub: the in-window render player is macOS-only. ----
#[cfg(not(target_os = "macos"))]
mod stub {
    use std::sync::Mutex;
    use tauri::{AppHandle, Runtime, State};

    use std::collections::HashMap;

    #[derive(Default)]
    pub struct PlayerState(pub Mutex<Option<()>>);

    #[tauri::command]
    pub fn player_init<R: Runtime>(
        _app: AppHandle<R>,
        _options: HashMap<String, String>,
        _observed: Vec<serde_json::Value>,
    ) -> Result<(), String> {
        Err("the in-window player is only available on macOS".into())
    }

    #[tauri::command]
    pub fn player_set_video_margin(
        _state: State<'_, PlayerState>,
        _bottom: f64,
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
}

#[cfg(not(target_os = "macos"))]
pub use stub::*;
