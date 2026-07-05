// macOS video surface: mpv render API into a layer-backed CAOpenGLLayer,
// composited BEHIND the transparent WKWebView.
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
// This file owns ONLY the surface; the mpv lifecycle lives in `core.rs`. It
// implements the `VideoSurface` trait (set_rect is a no-op — the host view
// autoresizes with the content view; detach performs the ordered teardown).

use std::ffi::{c_void, CString};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSView, NSWindowOrderingMode};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLLockContext, CGLPixelFormatAttribute,
    CGLPixelFormatObj, CGLUnlockContext,
};
use objc2_quartz_core::{CAAutoresizingMask, CALayer, CAOpenGLLayer};

use tauri::{AppHandle, Runtime};

use super::core::{rp_log, PreInit, VideoSurface};

// GL enum constants we need (not worth a GL crate).
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_VIEWPORT: u32 = 0x0BA2;
// 3.2 Core profile value for kCGLPFAOpenGLProfile.
const CGL_OGLP_VERSION_3_2_CORE: u32 = 0x3200;

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

struct VideoLayerIvars {
    mpv: Arc<Mpv>,
    render: Mutex<Option<SendRender>>,
    dead: AtomicBool,
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
            if ivars.dead.load(Ordering::Acquire) {
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
                if ivars.dead.load(Ordering::Acquire) {
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
                        let layer_ptr = self as *const VideoLayer as usize;
                        rc.set_update_callback(move || {
                            DispatchQueue::main().exec_async(move || {
                                let layer: &VideoLayer =
                                    unsafe { &*(layer_ptr as *const VideoLayer) };
                                layer.setNeedsDisplay();
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
        let this = Self::alloc().set_ivars(VideoLayerIvars {
            mpv,
            render: Mutex::new(None),
            dead: AtomicBool::new(false),
        });
        unsafe { msg_send![super(this), init] }
    }

    fn set_needs_display(&self) {
        self.setNeedsDisplay();
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
                layer.setBounds(NSRect::new(NSPoint::new(0.0, 0.0), b.size));
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

/// The macOS surface handle. Fields are Send (AppKit objects referenced only by
/// raw pointer / retained by the view hierarchy).
pub struct MacosSurface {
    /// Raw `NSView*` of the layer host, for main-thread teardown.
    host_view_ptr: usize,
    /// Raw `VideoLayer*`, for freeing its render context before mpv dies.
    layer_ptr: usize,
}

// The raw pointers are only touched on the main thread via GCD; Player is moved
// across threads (async commands run off-main), so the surface must be Send.
unsafe impl Send for MacosSurface {}

impl VideoSurface for MacosSurface {
    fn set_rect(&self, _x: i32, _y: i32, _w: i32, _h: i32) {
        // No-op: the host view autoresizes with the content view (see attach), so
        // the video always fills the window without explicit DOM-driven geometry.
    }

    fn detach(&self) {
        let host = self.host_view_ptr;
        let layer = self.layer_ptr;
        // ORDERED teardown, SYNCHRONOUS on the main thread: mark the layer dead
        // (draw callback becomes a no-op), remove the host view (CA stops drawing),
        // then FREE the mpv render context. This must complete before the shared
        // `Arc<Mpv>` drops and destroys mpv — freeing the render context after mpv
        // is destroyed is a use-after-free (the "back button crashes" bug).
        // exec_sync (not async) guarantees the ordering; detach is only ever called
        // off the main thread, so no dispatch_sync self-deadlock.
        DispatchQueue::main().exec_sync(move || {
            if layer != 0 {
                let l: &VideoLayer = unsafe { &*(layer as *const VideoLayer) };
                l.ivars().dead.store(true, Ordering::Release);
                if host != 0 {
                    let v: &NSView = unsafe { &*(host as *const NSView) };
                    v.removeFromSuperview();
                }
                // Frees mpv_render_context (Drop). Uncontended: draws see `dead`
                // and skip before locking.
                let _ = l.ivars().render.lock().unwrap().take();
            } else if host != 0 {
                let v: &NSView = unsafe { &*(host as *const NSView) };
                v.removeFromSuperview();
            }
        });
    }
}

/// Build the macOS video surface on the main thread and bind it to mpv. Called
/// from `core::create_player`. `app` is unused on macOS (the content view is taken
/// from `NSApplication`, not Tauri's window handle, which dispatch_sync-deadlocks
/// off-main).
/// The render-API surface needs nothing set up before mpv is initialized.
pub fn surface_pre_init<R: Runtime>(_app: &AppHandle<R>) -> Result<PreInit, String> {
    Ok(PreInit {
        options: Vec::new(),
        handle: 0,
    })
}

pub fn surface_attach<R: Runtime>(
    _app: &AppHandle<R>,
    mpv: Arc<Mpv>,
    _handle: usize,
) -> Result<Box<dyn VideoSurface>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(usize, usize), String>>();
    DispatchQueue::main().exec_async(move || {
        let _ = tx.send(setup_on_main(mpv));
    });
    let (host_view_ptr, layer_ptr) = rx
        .recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "timed out setting up the video surface".to_string())??;

    // Wait for the CA layer's first draw to create the mpv RenderContext BEFORE we
    // return — so mpv's vo=libmpv finds it the moment a file is loaded. Without
    // this, `create_player` returns and the caller loads a file before the async
    // first draw runs → mpv opens vo=libmpv with "No render context set" → the
    // video output fails permanently (black). We run off the main thread, so the
    // main run loop keeps drawing the layer while we poll.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let ready = {
            let layer: &VideoLayer = unsafe { &*(layer_ptr as *const VideoLayer) };
            layer
                .ivars()
                .render
                .lock()
                .map(|g| g.is_some())
                .unwrap_or(false)
        };
        if ready {
            rp_log("attach_surface: render context ready");
            break;
        }
        if std::time::Instant::now() >= deadline {
            rp_log("attach_surface: WARN render context not ready after 3s");
            break;
        }
        // Nudge a redraw (harmless if one is already pending) and yield.
        DispatchQueue::main().exec_async({
            let p = layer_ptr;
            move || {
                let l: &VideoLayer = unsafe { &*(p as *const VideoLayer) };
                l.setNeedsDisplay();
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(15));
    }

    Ok(Box::new(MacosSurface {
        host_view_ptr,
        layer_ptr,
    }))
}

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

    // Force a SYNCHRONOUS first draw NOW (async=false → display() draws on this
    // thread), which creates the mpv RenderContext before we return. Otherwise
    // `create_player` returns + the caller loads a file before the async first
    // draw runs, and mpv opens vo=libmpv with "No render context set" → the video
    // output fails permanently (vo-configured=no, black). Eager creation makes the
    // player robust to a load-immediately-after-init sequence.
    unsafe { layer.display() };
    rp_log(&format!(
        "setup_on_main: layer host inserted below webview; render_ready={}",
        layer.ivars().render.lock().map(|g| g.is_some()).unwrap_or(false)
    ));
    Ok((
        Retained::as_ptr(&host) as usize,
        Retained::as_ptr(&layer) as usize,
    ))
}
