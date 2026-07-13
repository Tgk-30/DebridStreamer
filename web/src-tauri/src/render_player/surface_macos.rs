// macOS video surface: mpv render API into a layer-backed CAOpenGLLayer,
// composited BEHIND the transparent WKWebView.
//
//   * A `CAOpenGLLayer` subclass (VideoLayer) hosts the GL surface. CoreAnimation
//     owns the context + backbuffer and calls our draw callback on its render
//     thread; we render an mpv frame into the bound FBO there. Being LAYER-BACKED,
//     it survives window occlusion/activation/Space changes - unlike a bare
//     NSOpenGLContext+NSView, which detaches (goes black) on those events.
//   * The layer is hosted in a plain NSView inserted below the WKWebView.
//   * mpv (vo=libmpv) + an `mpv_render_context` (OpenGL) drive the pixels; mpv's
//     render-update callback pokes the layer (`setNeedsDisplay`) when a new frame
//     is ready - CoreAnimation then calls our draw callback.
//
// This file owns ONLY the surface; the mpv lifecycle lives in `core.rs`. It
// implements the `VideoSurface` trait (set_rect is a no-op - the host view
// autoresizes with the content view; detach performs the ordered teardown).

use std::collections::HashMap;
use std::ffi::{c_void, CString};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSView, NSWindow, NSWindowDidEnterFullScreenNotification,
    NSWindowDidExitFullScreenNotification, NSWindowOrderingMode, NSWindowStyleMask,
    NSWindowWillCloseNotification, NSWindowWillEnterFullScreenNotification,
    NSWindowWillExitFullScreenNotification,
};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSObject, NSPoint, NSRect, NSSize,
};
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLLockContext, CGLPixelFormatAttribute,
    CGLPixelFormatObj, CGLUnlockContext,
};
use objc2_quartz_core::{CAAutoresizingMask, CALayer, CAOpenGLLayer};

use tauri::{AppHandle, Manager, Runtime};

use super::core::{rp_debug_enabled, rp_log, PreInit, VideoSurface};

// GL enum constants we need (not worth a GL crate).
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
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

/// Cover the complete drawable. OpenGL viewport dimensions are backing pixels.
fn gl_set_viewport(w: i32, h: i32) {
    type F = unsafe extern "C" fn(i32, i32, i32, i32);
    if let Some(f) = gl_fn::<F>("glViewport") {
        unsafe { f(0, 0, w, h) };
    }
}

// ---- The layer-backed video surface -------------------------------------
// The RenderContext is created on the CA render thread but must be FREED at
// teardown (before mpv is destroyed) from the main thread. mpv_render_context_free
// is thread-safe; we serialize all access with a Mutex, so the !Send wrapper is
// sound. `dead` gates the draw callback off once teardown starts.
struct SendRender(RenderContext);
unsafe impl Send for SendRender {}

/// Send-safe state shared with mpv's render-update callback. The callback must
/// never capture or dereference an Objective-C object off-main: it can run
/// concurrently with `mpv_render_context_free` during teardown. Holding only this
/// Arc (a raw layer pointer plus the `dead` flag) is what keeps it sound.
struct RenderCallbackState {
    layer_ptr: AtomicUsize,
    dead: AtomicBool,
}

#[derive(Clone, Copy)]
struct FrameSnapshot {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl FrameSnapshot {
    fn from_rect(rect: NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }

    fn as_rect(self) -> NSRect {
        NSRect::new(
            NSPoint::new(self.x, self.y),
            NSSize::new(self.width, self.height),
        )
    }
}

/// Send-safe native geometry and window-wrap state. Objective-C objects are held
/// only as raw addresses and are dereferenced exclusively on AppKit's main
/// thread. The atomics are updated by mpv's event thread.
struct SurfaceState {
    window_ptr: usize,
    content_view_ptr: usize,
    webview_ptr: usize,
    webview_sibling_ptr: usize,
    host_ptr: AtomicUsize,
    layer_ptr: AtomicUsize,
    dwidth: AtomicI64,
    dheight: AtomicI64,
    first_draw_logged: AtomicBool,
    last_draw_width: AtomicI64,
    last_draw_height: AtomicI64,
    geometry_check_queued: AtomicBool,
    last_main_geometry: Mutex<String>,
    wrap_active: AtomicBool,
    wrap_needs_resize: AtomicBool,
    wrap_dispatch_queued: AtomicBool,
    wrap_reconciling: AtomicBool,
    wrap_constraint_applied: AtomicBool,
    wrap_has_applied: AtomicBool,
    wrap_restore_pending: AtomicBool,
    pre_wrap_frame: Mutex<Option<FrameSnapshot>>,
    fullscreen_session_active: AtomicBool,
    fullscreen_enter_in_flight: AtomicBool,
    fullscreen_exit_in_flight: AtomicBool,
    dead: AtomicBool,
}

impl SurfaceState {
    fn new(
        window_ptr: usize,
        content_view_ptr: usize,
        webview_ptr: usize,
        webview_sibling_ptr: usize,
    ) -> Arc<Self> {
        Arc::new(Self {
            window_ptr,
            content_view_ptr,
            webview_ptr,
            webview_sibling_ptr,
            host_ptr: AtomicUsize::new(0),
            layer_ptr: AtomicUsize::new(0),
            dwidth: AtomicI64::new(0),
            dheight: AtomicI64::new(0),
            first_draw_logged: AtomicBool::new(false),
            last_draw_width: AtomicI64::new(0),
            last_draw_height: AtomicI64::new(0),
            geometry_check_queued: AtomicBool::new(false),
            last_main_geometry: Mutex::new(String::new()),
            wrap_active: AtomicBool::new(false),
            wrap_needs_resize: AtomicBool::new(true),
            wrap_dispatch_queued: AtomicBool::new(false),
            wrap_reconciling: AtomicBool::new(false),
            wrap_constraint_applied: AtomicBool::new(false),
            wrap_has_applied: AtomicBool::new(false),
            wrap_restore_pending: AtomicBool::new(false),
            pre_wrap_frame: Mutex::new(None),
            fullscreen_session_active: AtomicBool::new(false),
            fullscreen_enter_in_flight: AtomicBool::new(false),
            fullscreen_exit_in_flight: AtomicBool::new(false),
            dead: AtomicBool::new(false),
        })
    }

    fn dimension_text(&self) -> (String, String) {
        let width = self.dwidth.load(Ordering::Acquire);
        let height = self.dheight.load(Ordering::Acquire);
        (
            if width > 0 {
                width.to_string()
            } else {
                "?".to_string()
            },
            if height > 0 {
                height.to_string()
            } else {
                "?".to_string()
            },
        )
    }
}

fn note_fullscreen_will_enter(surface: &SurfaceState) {
    // Do not clear contentAspectRatio here. WillEnter is close to AppKit's exit
    // frame snapshot, and a valid windowed ratio does not need to be rewritten
    // for fullscreen layout. The live surface reconciles only after DidExit.
    surface
        .fullscreen_session_active
        .store(true, Ordering::Release);
    surface
        .fullscreen_enter_in_flight
        .store(true, Ordering::Release);
    surface
        .fullscreen_exit_in_flight
        .store(false, Ordering::Release);
}

fn note_fullscreen_did_enter(surface: &SurfaceState) {
    surface
        .fullscreen_session_active
        .store(true, Ordering::Release);
    surface
        .fullscreen_enter_in_flight
        .store(false, Ordering::Release);
    surface
        .fullscreen_exit_in_flight
        .store(false, Ordering::Release);
}

fn note_fullscreen_will_exit(surface: &SurfaceState) {
    surface
        .fullscreen_session_active
        .store(true, Ordering::Release);
    surface
        .fullscreen_enter_in_flight
        .store(false, Ordering::Release);
    surface
        .fullscreen_exit_in_flight
        .store(true, Ordering::Release);
}

/// Returns true when this DidExit completed the current fullscreen session.
/// A nested WillEnter posted by another observer takes precedence.
fn note_fullscreen_did_exit(surface: &SurfaceState) -> bool {
    surface
        .fullscreen_exit_in_flight
        .store(false, Ordering::Release);
    if surface
        .fullscreen_enter_in_flight
        .load(Ordering::Acquire)
    {
        return false;
    }
    surface
        .fullscreen_session_active
        .store(false, Ordering::Release);
    true
}

// A surface can be torn down while its NSWindow is fullscreen. The host view
// cannot own the eventual cleanup because teardown removes that view and all of
// its notification registrations. This small observer is retained independently
// in a main-thread-only registry until the window exits fullscreen or closes.
struct PostFullscreenCleanupIvars {
    surface: Arc<SurfaceState>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "DSPostFullscreenCleanup"]
    #[ivars = PostFullscreenCleanupIvars]
    #[thread_kind = MainThreadOnly]
    struct PostFullscreenCleanup;

    impl PostFullscreenCleanup {
        #[unsafe(method(windowWillEnterFullScreen:))]
        fn window_will_enter_full_screen(&self, _notification: &NSNotification) {
            note_fullscreen_will_enter(&self.ivars().surface);
        }

        #[unsafe(method(windowDidEnterFullScreen:))]
        fn window_did_enter_full_screen(&self, _notification: &NSNotification) {
            note_fullscreen_did_enter(&self.ivars().surface);
        }

        #[unsafe(method(windowWillExitFullScreen:))]
        fn window_will_exit_full_screen(&self, _notification: &NSNotification) {
            note_fullscreen_will_exit(&self.ivars().surface);
        }

        #[unsafe(method(windowDidExitFullScreen:))]
        fn window_did_exit_full_screen(&self, _notification: &NSNotification) {
            let surface = &self.ivars().surface;
            // Preserve a nested WillEnter from another DidExit observer. If a
            // new transition has already begun, this helper remains registered
            // for that fullscreen session's eventual DidExit.
            if !note_fullscreen_did_exit(surface) {
                return;
            }
            finish_post_fullscreen_cleanup_on_main(self, true, "did-exit-fullscreen");
        }

        #[unsafe(method(windowWillClose:))]
        fn window_will_close(&self, _notification: &NSNotification) {
            finish_post_fullscreen_cleanup_on_main(self, false, "window-close");
        }
    }
);

impl PostFullscreenCleanup {
    fn new(mtm: MainThreadMarker, surface: Arc<SurfaceState>) -> Retained<Self> {
        let this = mtm
            .alloc::<Self>()
            .set_ivars(PostFullscreenCleanupIvars { surface });
        unsafe { msg_send![super(this), init] }
    }
}

struct VideoLayerIvars {
    mpv: Arc<Mpv>,
    render: Mutex<Option<SendRender>>,
    callback: Arc<RenderCallbackState>,
    surface: Arc<SurfaceState>,
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
            // Teardown has started - do not touch mpv/render at all.
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
                        // When mpv has a new frame, poke the layer to redraw (on the
                        // main thread - CALayer.setNeedsDisplay). mpv may invoke this
                        // callback while the render context is being freed, so capture
                        // only send-safe state: a raw VideoLayer pointer here caused a
                        // reproducible use-after-free during teardown.
                        let callback = ivars.callback.clone();
                        rc.set_update_callback(move || {
                            if callback.dead.load(Ordering::Acquire) {
                                return;
                            }
                            let redraw = callback.clone();
                            DispatchQueue::main().exec_async(move || {
                                // Teardown and this closure both serialize on the main
                                // queue. Re-check the flag because the redraw may have
                                // been queued before teardown ran.
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

            // CALayer bounds are points; contentsScale maps them to the backing
            // store's pixels. GL_VIEWPORT is mutable drawing state (including
            // state left by mpv), not framebuffer-size metadata, so feeding it
            // back as mpv_opengl_fbo.w/h can render into only part of the drawable
            // and can give mpv the wrong target aspect after a resize.
            let bounds = self.bounds();
            let scale = self.contentsScale();
            let w = (bounds.size.width * scale).round().max(1.0) as i32;
            let h = (bounds.size.height * scale).round().max(1.0) as i32;
            let fbo = gl_get_int(GL_FRAMEBUFFER_BINDING);
            let previous_w = ivars
                .surface
                .last_draw_width
                .swap(i64::from(w), Ordering::AcqRel);
            let previous_h = ivars
                .surface
                .last_draw_height
                .swap(i64::from(h), Ordering::AcqRel);
            let first_draw = !ivars
                .surface
                .first_draw_logged
                .swap(true, Ordering::AcqRel);
            if first_draw {
                if rp_debug_enabled() {
                    let cached = ivars
                        .surface
                        .last_main_geometry
                        .lock()
                        .map(|v| v.clone())
                        .unwrap_or_default();
                    let frame = self.frame();
                    let (dwidth, dheight) = ivars.surface.dimension_text();
                    rp_log(&format!(
                        "RPGEO event=first-draw engine=native-mpv {cached} draw.layer.frame={} draw.layer.bounds={} draw.contentsScale={scale:.3} mpv_target_px={w}x{h} fbo={fbo} dwidth={dwidth} dheight={dheight} correction_check=queued",
                        rect_text(frame),
                        rect_text(bounds),
                    ));
                }
            }
            // The attach-time check is not enough: AppKit can resize the
            // fullscreen content hierarchy after the first frame. Re-arm the
            // cheap main-thread geometry check whenever the actual target handed
            // to mpv changes. Multiple transition draws coalesce into one check.
            if first_draw
                || previous_w != i64::from(w)
                || previous_h != i64::from(h)
            {
                queue_geometry_check(ivars.surface.clone(), first_draw);
            }
            gl_set_viewport(w, h);
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
    fn new(mpv: Arc<Mpv>, surface: Arc<SurfaceState>) -> Retained<Self> {
        let callback = Arc::new(RenderCallbackState {
            layer_ptr: AtomicUsize::new(0),
            dead: AtomicBool::new(false),
        });
        let this = Self::alloc().set_ivars(VideoLayerIvars {
            mpv,
            render: Mutex::new(None),
            callback: callback.clone(),
            surface: surface.clone(),
        });
        let layer: Retained<Self> = unsafe { msg_send![super(this), init] };
        // Publish the real layer pointer only after init, for the send-safe
        // render-update callback to reach the layer without capturing a raw
        // Objective-C pointer of its own.
        callback
            .layer_ptr
            .store(Retained::as_ptr(&layer) as usize, Ordering::Release);
        surface
            .layer_ptr
            .store(Retained::as_ptr(&layer) as usize, Ordering::Release);
        layer
    }
}

// ---- Host view: redraws the video layer on every resize -----------------
// The video layer autoresizes to fill this view, but CAOpenGLLayer only
// reallocates its GL drawable + re-renders when explicitly asked. Overriding
// setFrameSize (called by AppKit on every resize step) to poke the layer makes
// the video re-render at the new native resolution - even while paused/ended - 
// instead of stretching a stale texture.
struct HostIvars {
    layer: Retained<VideoLayer>,
    surface: Arc<SurfaceState>,
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
            let surface = &self.ivars().surface;
            surface
                .host_ptr
                .store(self as *const HostView as usize, Ordering::Release);
            unsafe {
                let _: () = msg_send![super(self), setFrameSize: size];
            }
            let layer = &self.ivars().layer;
            // A fullscreen transition can move the window to a screen with a
            // different backing scale without delivering the backing callback
            // before this resize. Always pair the resized bounds with the live
            // window scale before the synchronous draw.
            if let Some(window) = self.window() {
                let scale = window.backingScaleFactor();
                if (layer.contentsScale() - scale).abs() > 0.001 {
                    unsafe { layer.setContentsScale(scale) };
                }
            }
            // Resize the layer to the view + force CAOpenGLLayer to reallocate
            // its GL drawable at the new size (a plain setNeedsDisplay does not
            // reliably grow it). Wrapped so the geometry change doesn't animate.
            let b = self.bounds();
            layer.setFrame(b);
            unsafe {
                layer.setBounds(NSRect::new(NSPoint::new(0.0, 0.0), b.size));
            };
            log_geometry_on_main(
                "set-frame-size",
                surface,
                &format!("requested={:.2}x{:.2}", size.width, size.height),
            );
            unsafe { layer.display() };
        }

        // AppKit fires this whenever the backing SCALE FACTOR changes - most often
        // when the window is dragged between a Retina (2x) and a non-Retina (1x)
        // display. contentsScale is otherwise set ONCE at setup, so without this the
        // CAOpenGLLayer keeps rendering at the launch display's pixel density:
        // half-resolution (soft/blurry) on 1x→2x, or wastefully 2x on 2x→1x. Re-sync
        // it and force a native-res re-render.
        #[unsafe(method(viewDidChangeBackingProperties))]
        fn view_did_change_backing_properties(&self) {
            unsafe {
                let _: () = msg_send![super(self), viewDidChangeBackingProperties];
            }
            let scale = self
                .window()
                .map(|w| w.backingScaleFactor())
                .unwrap_or(1.0);
            let layer = &self.ivars().layer;
            unsafe { layer.setContentsScale(scale) };
            let b = self.bounds();
            layer.setFrame(b);
            unsafe {
                layer.setBounds(NSRect::new(NSPoint::new(0.0, 0.0), b.size));
            };
            log_geometry_on_main(
                "backing-change",
                &self.ivars().surface,
                &format!("new_scale={scale:.3}"),
            );
            unsafe { layer.display() };
        }

        #[unsafe(method(windowWillEnterFullScreen:))]
        fn window_will_enter_full_screen(&self, _notification: &NSNotification) {
            let surface = &self.ivars().surface;
            note_fullscreen_will_enter(surface);
            log_fullscreen_state_on_main(surface, "will-enter");
        }

        #[unsafe(method(windowDidEnterFullScreen:))]
        fn window_did_enter_full_screen(&self, _notification: &NSNotification) {
            let surface = &self.ivars().surface;
            note_fullscreen_did_enter(surface);
            log_fullscreen_state_on_main(surface, "did-enter");
            if surface.dead.load(Ordering::Acquire) {
                return;
            }
            // AppKit owns the NSWindow frame during the transition, but the video
            // hierarchy is ours. Repair it against the final screen-sized content
            // bounds even if autoresizing did not invoke setFrameSize.
            verify_and_repair_geometry_on_main(
                surface,
                Some("did-enter-fullscreen-check"),
                true,
            );
        }

        #[unsafe(method(windowWillExitFullScreen:))]
        fn window_will_exit_full_screen(&self, _notification: &NSNotification) {
            let surface = &self.ivars().surface;
            note_fullscreen_will_exit(surface);
            log_fullscreen_state_on_main(surface, "will-exit");
        }

        #[unsafe(method(windowDidExitFullScreen:))]
        fn window_did_exit_full_screen(&self, _notification: &NSNotification) {
            let surface = &self.ivars().surface;
            note_fullscreen_did_exit(surface);
            log_fullscreen_state_on_main(surface, "did-exit");
            resume_window_wrap_on_main(surface);
        }

        #[unsafe(method(windowWillClose:))]
        fn window_will_close(&self, _notification: &NSNotification) {
            let surface = self.ivars().surface.clone();
            // Removing the host is part of teardown. Hold the receiver until this
            // notification method returns so removeFromSuperview cannot release it
            // out from under the current Objective-C call.
            let _keep_alive: Option<Retained<HostView>> = unsafe {
                Retained::retain(self as *const HostView as *mut HostView)
            };
            teardown_surface_on_main(&surface, "window-close", false);
        }
    }
);

impl HostView {
    fn new(
        mtm: MainThreadMarker,
        frame: NSRect,
        layer: Retained<VideoLayer>,
        surface: Arc<SurfaceState>,
    ) -> Retained<Self> {
        let this = mtm
            .alloc::<HostView>()
            .set_ivars(HostIvars { layer, surface });
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }
}

// ---- Geometry diagnostics + self-healing -------------------------------

fn rect_text(rect: NSRect) -> String {
    format!(
        "({:.2},{:.2},{:.2},{:.2})",
        rect.origin.x, rect.origin.y, rect.size.width, rect.size.height
    )
}

fn rect_matches(a: NSRect, b: NSRect) -> bool {
    const EPSILON: f64 = 0.25;
    (a.origin.x - b.origin.x).abs() <= EPSILON
        && (a.origin.y - b.origin.y).abs() <= EPSILON
        && (a.size.width - b.size.width).abs() <= EPSILON
        && (a.size.height - b.size.height).abs() <= EPSILON
}

/// Capture every coordinate space that can explain a four-sided inset. This is
/// called only on the AppKit main thread. Each call writes one greppable RPGEO
/// line and also caches the numeric snapshot for the CA first-draw callback.
fn log_geometry_on_main(event: &str, surface: &SurfaceState, extra: &str) {
    if !rp_debug_enabled() {
        return;
    }
    if surface.window_ptr == 0 || surface.content_view_ptr == 0 {
        rp_log(&format!(
            "RPGEO event={event} engine=native-mpv geometry=unavailable {extra}"
        ));
        return;
    }

    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    let content: &NSView = unsafe { &*(surface.content_view_ptr as *const NSView) };
    let window_frame = window.frame();
    let content_frame = content.frame();
    let content_bounds = content.bounds();
    let content_layout = window.contentLayoutRect();
    let safe = content.safeAreaInsets();
    let window_scale = window.backingScaleFactor();
    let actual_content_ptr = window
        .contentView()
        .map(|view| Retained::as_ptr(&view) as usize)
        .unwrap_or(0);

    let (webview_frame, webview_bounds) = if surface.webview_ptr != 0 {
        let view: &NSView = unsafe { &*(surface.webview_ptr as *const NSView) };
        (rect_text(view.frame()), rect_text(view.bounds()))
    } else {
        ("?".to_string(), "?".to_string())
    };
    let (sibling_frame, sibling_bounds) = if surface.webview_sibling_ptr != 0 {
        let sibling: &NSView =
            unsafe { &*(surface.webview_sibling_ptr as *const NSView) };
        (rect_text(sibling.frame()), rect_text(sibling.bounds()))
    } else {
        ("?".to_string(), "?".to_string())
    };

    let host_ptr = surface.host_ptr.load(Ordering::Acquire);
    let (host_frame, host_bounds, host_parent_ptr) = if host_ptr != 0 {
        let host: &NSView = unsafe { &*(host_ptr as *const NSView) };
        let parent = unsafe { host.superview() }
            .map(|view| Retained::as_ptr(&view) as usize)
            .unwrap_or(0);
        (rect_text(host.frame()), rect_text(host.bounds()), parent)
    } else {
        ("?".to_string(), "?".to_string(), 0)
    };

    let layer_ptr = surface.layer_ptr.load(Ordering::Acquire);
    let (layer_frame, layer_bounds, scale, target_width, target_height) =
        if layer_ptr != 0 {
            let layer: &VideoLayer = unsafe { &*(layer_ptr as *const VideoLayer) };
            let bounds = layer.bounds();
            let scale = layer.contentsScale();
            (
                rect_text(layer.frame()),
                rect_text(bounds),
                scale,
                (bounds.size.width * scale).round().max(1.0) as i32,
                (bounds.size.height * scale).round().max(1.0) as i32,
            )
        } else {
            ("?".to_string(), "?".to_string(), 0.0, 0, 0)
        };
    let content_aspect = window.contentAspectRatio();
    let fullscreen = window.styleMask().contains(NSWindowStyleMask::FullScreen);
    let (dwidth, dheight) = surface.dimension_text();
    let last_draw_width = surface.last_draw_width.load(Ordering::Acquire);
    let last_draw_height = surface.last_draw_height.load(Ordering::Acquire);
    let fields = format!(
        "window.ptr=0x{:x} window.frame={} window.backingScale={:.3} content.ptr=0x{:x} content.actual=0x{:x} content.frame={} content.bounds={} contentLayoutRect={} content.safe=({:.2},{:.2},{:.2},{:.2}) webview.ptr=0x{:x} webview.frame={} webview.bounds={} sibling.ptr=0x{:x} sibling.frame={} sibling.bounds={} host.ptr=0x{:x} host.super=0x{:x} host.frame={} host.bounds={} layer.ptr=0x{:x} layer.frame={} layer.bounds={} contentsScale={:.3} mpv_target_px={}x{} last_draw_target_px={}x{} dwidth={} dheight={} contentAspect={:.3}x{:.3} fullscreen={}",
        surface.window_ptr,
        rect_text(window_frame),
        window_scale,
        surface.content_view_ptr,
        actual_content_ptr,
        rect_text(content_frame),
        rect_text(content_bounds),
        rect_text(content_layout),
        safe.top,
        safe.left,
        safe.bottom,
        safe.right,
        surface.webview_ptr,
        webview_frame,
        webview_bounds,
        surface.webview_sibling_ptr,
        sibling_frame,
        sibling_bounds,
        host_ptr,
        host_parent_ptr,
        host_frame,
        host_bounds,
        layer_ptr,
        layer_frame,
        layer_bounds,
        scale,
        target_width,
        target_height,
        last_draw_width,
        last_draw_height,
        dwidth,
        dheight,
        content_aspect.width,
        content_aspect.height,
        fullscreen,
    );
    if let Ok(mut cached) = surface.last_main_geometry.lock() {
        *cached = fields.clone();
    }
    rp_log(&format!(
        "RPGEO event={event} engine=native-mpv {fields} {extra}"
    ));
}

fn queue_geometry_check(surface: Arc<SurfaceState>, log_first_draw_result: bool) {
    if surface.dead.load(Ordering::Acquire)
        || surface
            .geometry_check_queued
            .swap(true, Ordering::AcqRel)
    {
        return;
    }
    DispatchQueue::main().exec_async(move || {
        surface
            .geometry_check_queued
            .store(false, Ordering::Release);
        if surface.dead.load(Ordering::Acquire) {
            return;
        }
        let log_event = if log_first_draw_result {
            Some("first-draw-check")
        } else {
            None
        };
        verify_and_repair_geometry_on_main(&surface, log_event, false);
    });
}

/// Verify the native hierarchy after CoreAnimation has actually drawn. This runs
/// after attach, at fullscreen completion, and whenever the rendered target size
/// changes. If a framework changed the hierarchy or frame, move the host back
/// below the WKWebView's top-level sibling and re-fill contentView.bounds. This
/// reads NSWindow geometry but mutates only NSView and CALayer properties.
fn verify_and_repair_geometry_on_main(
    surface: &SurfaceState,
    log_event: Option<&str>,
    force_display: bool,
) {
    if surface.dead.load(Ordering::Acquire) {
        return;
    }
    let host_ptr = surface.host_ptr.load(Ordering::Acquire);
    let layer_ptr = surface.layer_ptr.load(Ordering::Acquire);
    if surface.window_ptr == 0
        || surface.content_view_ptr == 0
        || host_ptr == 0
        || layer_ptr == 0
    {
        if let Some(event) = log_event {
            log_geometry_on_main(event, surface, "correction=unavailable");
        }
        return;
    }
    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    let content: &NSView = unsafe { &*(surface.content_view_ptr as *const NSView) };
    let host: &HostView = unsafe { &*(host_ptr as *const HostView) };
    let layer: &VideoLayer = unsafe { &*(layer_ptr as *const VideoLayer) };
    let mut corrections = Vec::new();

    let parent_ptr = unsafe { host.superview() }
        .map(|view| Retained::as_ptr(&view) as usize)
        .unwrap_or(0);
    if parent_ptr != surface.content_view_ptr {
        let sibling = if surface.webview_sibling_ptr != 0 {
            Some(unsafe { &*(surface.webview_sibling_ptr as *const NSView) })
        } else {
            None
        };
        content.addSubview_positioned_relativeTo(host, NSWindowOrderingMode::Below, sibling);
        corrections.push("parent");
    }

    let expected_host = content.bounds();
    if !rect_matches(host.frame(), expected_host) {
        host.setFrame(expected_host);
        corrections.push("host-frame");
    }
    let host_bounds = host.bounds();
    let expected_layer_bounds = NSRect::new(NSPoint::new(0.0, 0.0), host_bounds.size);
    if !rect_matches(layer.frame(), host_bounds) {
        layer.setFrame(host_bounds);
        corrections.push("layer-frame");
    }
    if !rect_matches(layer.bounds(), expected_layer_bounds) {
        unsafe { layer.setBounds(expected_layer_bounds) };
        corrections.push("layer-bounds");
    }
    let expected_scale = window.backingScaleFactor();
    if (layer.contentsScale() - expected_scale).abs() > 0.001 {
        unsafe { layer.setContentsScale(expected_scale) };
        corrections.push("contents-scale");
    }
    if force_display || !corrections.is_empty() {
        unsafe { layer.display() };
    }
    let correction = if corrections.is_empty() {
        "none".to_string()
    } else {
        corrections.join(",")
    };
    if let Some(event) = log_event {
        log_geometry_on_main(event, surface, &format!("correction={correction}"));
    } else if !corrections.is_empty() {
        log_geometry_on_main(
            "drawable-change-check",
            surface,
            &format!("correction={correction}"),
        );
    }
}

// ---- Native NSWindow aspect lifecycle ----------------------------------

fn gcd(mut a: i64, mut b: i64) -> i64 {
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a.max(1)
}

fn normalized_aspect(width: i64, height: i64) -> NSSize {
    let divisor = gcd(width, height);
    NSSize::new((width / divisor) as f64, (height / divisor) as f64)
}

fn screen_limits(window: &NSWindow) -> (Option<NSRect>, NSSize) {
    let visible = window.screen().map(|screen| screen.visibleFrame());
    let maximum = visible
        .map(|frame| window.contentRectForFrameRect(frame).size)
        .unwrap_or_else(|| NSSize::new(f64::MAX / 4.0, f64::MAX / 4.0));
    (visible, maximum)
}

fn bounded_minimum(minimum: NSSize, maximum: NSSize) -> NSSize {
    NSSize::new(
        minimum.width.max(1.0).min(maximum.width.max(1.0)),
        minimum.height.max(1.0).min(maximum.height.max(1.0)),
    )
}

fn aspect_preserving_screen_clamp(size: NSSize, maximum: NSSize) -> NSSize {
    let scale = (maximum.width.max(1.0) / size.width.max(1.0))
        .min(maximum.height.max(1.0) / size.height.max(1.0))
        .min(1.0);
    NSSize::new(size.width * scale, size.height * scale)
}

fn exact_size_or_letterbox(
    exact: NSSize,
    minimum: NSSize,
    maximum: NSSize,
) -> (NSSize, bool) {
    let fitted = aspect_preserving_screen_clamp(exact, maximum);
    if fitted.width + 0.01 >= minimum.width.max(1.0)
        && fitted.height + 0.01 >= minimum.height.max(1.0)
    {
        (fitted, false)
    } else {
        // The visible screen cannot contain this aspect at or above both
        // content minimums. This is the only path that permits letterboxing.
        (bounded_minimum(minimum, maximum), true)
    }
}

/// Preserve width, but grow it when the resulting exact-aspect height would
/// violate the content minimum. Any screen clamp scales both axes together.
fn width_based_wrap_size(
    current: NSSize,
    aspect: f64,
    minimum: NSSize,
    maximum: NSSize,
) -> (NSSize, bool) {
    let mut width = current.width.max(minimum.width).max(1.0);
    let mut height = width / aspect;
    if height + 0.01 < minimum.height.max(1.0) {
        height = minimum.height.max(1.0);
        width = height * aspect;
    }
    exact_size_or_letterbox(NSSize::new(width, height), minimum, maximum)
}

/// Preserve height for tall content, growing it when the resulting exact-aspect
/// width would violate the content minimum. The final clamp stays exact-aspect.
fn height_based_wrap_size(
    current: NSSize,
    aspect: f64,
    minimum: NSSize,
    maximum: NSSize,
) -> (NSSize, bool) {
    let mut height = current.height.max(minimum.height).max(1.0);
    let mut width = height * aspect;
    if width + 0.01 < minimum.width.max(1.0) {
        width = minimum.width.max(1.0);
        height = width / aspect;
    }
    exact_size_or_letterbox(NSSize::new(width, height), minimum, maximum)
}

/// The first wrap follows the content axis: wide video preserves width and tall
/// video preserves height. Both paths grow the preserved axis to satisfy the
/// other minimum before applying an aspect-preserving screen clamp.
fn first_wrap_size(
    current: NSSize,
    aspect: f64,
    minimum: NSSize,
    maximum: NSSize,
) -> (NSSize, bool) {
    if aspect >= 1.0 {
        width_based_wrap_size(current, aspect, minimum, maximum)
    } else {
        height_based_wrap_size(current, aspect, minimum, maximum)
    }
}

/// Later aspect changes keep the established width-preserving behavior, with
/// the same minimum-driven growth and exact-aspect screen clamp as a wide first
/// wrap.
fn width_preserving_wrap_size(
    current: NSSize,
    aspect: f64,
    minimum: NSSize,
    maximum: NSSize,
) -> (NSSize, bool) {
    width_based_wrap_size(current, aspect, minimum, maximum)
}

fn centered_frame_within_visible(
    window: &NSWindow,
    old_frame: NSRect,
    content_size: NSSize,
    visible_frame: Option<NSRect>,
) -> NSRect {
    let content_rect = NSRect::new(NSPoint::new(0.0, 0.0), content_size);
    let fitted_size = window.frameRectForContentRect(content_rect).size;
    let mut origin = NSPoint::new(
        old_frame.origin.x + (old_frame.size.width - fitted_size.width) / 2.0,
        old_frame.origin.y + (old_frame.size.height - fitted_size.height) / 2.0,
    );
    if let Some(visible) = visible_frame {
        let max_x = visible.origin.x + (visible.size.width - fitted_size.width).max(0.0);
        let max_y = visible.origin.y + (visible.size.height - fitted_size.height).max(0.0);
        origin.x = origin.x.max(visible.origin.x).min(max_x);
        origin.y = origin.y.max(visible.origin.y).min(max_y);
    }
    NSRect::new(origin, fitted_size)
}

// NSNotificationCenter does not own selector observers strongly. Keep exactly
// one post-fullscreen cleanup alive per NSWindow without placing it on the host
// view that teardown removes. The registry contains raw retained pointers only;
// all insertion/removal and Objective-C dereferences happen on the main thread.
static POST_FULLSCREEN_CLEANUPS: OnceLock<Mutex<HashMap<usize, usize>>> =
    OnceLock::new();

fn post_fullscreen_cleanup_registry() -> &'static Mutex<HashMap<usize, usize>> {
    POST_FULLSCREEN_CLEANUPS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn take_post_fullscreen_cleanup_on_main(
    window_ptr: usize,
    expected_observer_ptr: Option<usize>,
) -> Option<Retained<PostFullscreenCleanup>> {
    let raw = {
        let mut registry = post_fullscreen_cleanup_registry().lock().unwrap();
        let observer_ptr = *registry.get(&window_ptr)?;
        if let Some(expected) = expected_observer_ptr {
            if expected != observer_ptr {
                return None;
            }
        }
        registry.remove(&window_ptr)
    }?;
    unsafe { Retained::from_raw(raw as *mut PostFullscreenCleanup) }
}

fn discard_window_wrap_state(surface: &SurfaceState) {
    surface.wrap_needs_resize.store(false, Ordering::Release);
    surface
        .wrap_constraint_applied
        .store(false, Ordering::Release);
    surface.wrap_has_applied.store(false, Ordering::Release);
    surface
        .wrap_restore_pending
        .store(false, Ordering::Release);
    surface
        .fullscreen_session_active
        .store(false, Ordering::Release);
    surface
        .fullscreen_enter_in_flight
        .store(false, Ordering::Release);
    surface
        .fullscreen_exit_in_flight
        .store(false, Ordering::Release);
    if let Ok(mut saved) = surface.pre_wrap_frame.lock() {
        *saved = None;
    }
}

fn cancel_post_fullscreen_cleanup_on_main(
    window_ptr: usize,
    reason: &str,
) -> Option<(bool, bool, bool)> {
    let Some(observer) = take_post_fullscreen_cleanup_on_main(window_ptr, None) else {
        return None;
    };
    let center = NSNotificationCenter::defaultCenter();
    unsafe { center.removeObserver(&*observer) };
    let surface = &observer.ivars().surface;
    let transition_state = (
        surface
            .fullscreen_session_active
            .load(Ordering::Acquire),
        surface
            .fullscreen_enter_in_flight
            .load(Ordering::Acquire),
        surface
            .fullscreen_exit_in_flight
            .load(Ordering::Acquire),
    );
    discard_window_wrap_state(surface);
    rp_log(&format!(
        "post-fullscreen-cleanup: action=cancel window=0x{window_ptr:x} reason={reason}"
    ));
    Some(transition_state)
}

fn register_post_fullscreen_cleanup_on_main(surface: Arc<SurfaceState>) {
    let window_ptr = surface.window_ptr;
    if window_ptr == 0 {
        return;
    }
    let _ = cancel_post_fullscreen_cleanup_on_main(window_ptr, "replace");

    let mtm = MainThreadMarker::new()
        .expect("post-fullscreen cleanup must be registered on the main thread");
    let window: &NSWindow = unsafe { &*(window_ptr as *const NSWindow) };
    let observer = PostFullscreenCleanup::new(mtm, surface);
    let center = NSNotificationCenter::defaultCenter();
    unsafe {
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(windowWillEnterFullScreen:),
            Some(NSWindowWillEnterFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(windowDidEnterFullScreen:),
            Some(NSWindowDidEnterFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(windowWillExitFullScreen:),
            Some(NSWindowWillExitFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(windowDidExitFullScreen:),
            Some(NSWindowDidExitFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            &*observer,
            objc2::sel!(windowWillClose:),
            Some(NSWindowWillCloseNotification),
            Some(window),
        );
    }
    let observer_ptr = Retained::as_ptr(&observer) as usize;
    let retained_ptr = Retained::into_raw(observer) as usize;
    post_fullscreen_cleanup_registry()
        .lock()
        .unwrap()
        .insert(window_ptr, retained_ptr);
    rp_log(&format!(
        "post-fullscreen-cleanup: action=register window=0x{window_ptr:x} observer=0x{observer_ptr:x}"
    ));
}

fn finish_post_fullscreen_cleanup_on_main(
    observer: &PostFullscreenCleanup,
    apply_window_cleanup: bool,
    reason: &str,
) {
    let window_ptr = observer.ivars().surface.window_ptr;
    let observer_ptr = observer as *const PostFullscreenCleanup as usize;
    let Some(owner) =
        take_post_fullscreen_cleanup_on_main(window_ptr, Some(observer_ptr))
    else {
        return;
    };

    // The registry-owned retain keeps the observer alive through this callback.
    // Stop every notification before its retain is released at function exit.
    let center = NSNotificationCenter::defaultCenter();
    unsafe { center.removeObserver(observer) };

    let surface = &owner.ivars().surface;
    let mut window_cleanup_applied = false;
    if apply_window_cleanup {
        let cleared = clear_window_aspect_on_main(surface, reason);
        if cleared {
            window_cleanup_applied = true;
            restore_pre_wrap_frame_on_main(surface, reason);
        }
    }
    discard_window_wrap_state(surface);
    rp_log(&format!(
        "post-fullscreen-cleanup: action=finish window=0x{window_ptr:x} observer=0x{observer_ptr:x} reason={reason} applied={window_cleanup_applied}"
    ));
}

fn save_pre_wrap_frame_on_main(surface: &SurfaceState, window: &NSWindow) -> bool {
    if surface.wrap_has_applied.load(Ordering::Acquire) {
        return false;
    }
    if let Ok(mut saved) = surface.pre_wrap_frame.lock() {
        if saved.is_none() {
            *saved = Some(FrameSnapshot::from_rect(window.frame()));
        }
    }
    surface.wrap_has_applied.store(true, Ordering::Release);
    true
}

/// AppKit owns every NSWindow property for the complete fullscreen lifecycle.
/// The style bit covers stable fullscreen and the explicit flags cover both
/// transition intervals. The session latch deliberately stays set from
/// WillEnter through DidExit as a conservative fallback if WillExit is late or
/// absent while AppKit has already cleared the style bit.
fn in_fullscreen_or_transition_on_main(
    surface: &SurfaceState,
    window: &NSWindow,
) -> bool {
    window.styleMask().contains(NSWindowStyleMask::FullScreen)
        || surface
            .fullscreen_session_active
            .load(Ordering::Acquire)
        || surface
            .fullscreen_enter_in_flight
            .load(Ordering::Acquire)
        || surface
            .fullscreen_exit_in_flight
            .load(Ordering::Acquire)
}

fn window_property_mutation_allowed_on_main(
    surface: &SurfaceState,
    window: &NSWindow,
) -> bool {
    !in_fullscreen_or_transition_on_main(surface, window)
}

fn log_fullscreen_state_on_main(surface: &SurfaceState, event: &str) {
    if surface.window_ptr == 0 {
        return;
    }
    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    let style_fullscreen = window
        .styleMask()
        .contains(NSWindowStyleMask::FullScreen);
    let session_active = surface
        .fullscreen_session_active
        .load(Ordering::Acquire);
    let enter_in_flight = surface
        .fullscreen_enter_in_flight
        .load(Ordering::Acquire);
    let exit_in_flight = surface
        .fullscreen_exit_in_flight
        .load(Ordering::Acquire);
    log_geometry_on_main(
        "window-wrap",
        surface,
        &format!(
            "action=fullscreen-state event={event} style_fullscreen={style_fullscreen} session_active={session_active} enter_in_flight={enter_in_flight} exit_in_flight={exit_in_flight}"
        ),
    );
}

fn restore_pre_wrap_frame_on_main(surface: &SurfaceState, reason: &str) -> bool {
    let saved = surface
        .pre_wrap_frame
        .lock()
        .ok()
        .and_then(|frame| *frame);
    let Some(saved) = saved else {
        surface
            .wrap_restore_pending
            .store(false, Ordering::Release);
        return false;
    };
    if surface.window_ptr == 0 {
        surface
            .wrap_restore_pending
            .store(true, Ordering::Release);
        return false;
    }
    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    // Re-evaluate the complete predicate immediately before setFrame. Queued
    // reconciliation may have been requested before a transition began.
    if !window_property_mutation_allowed_on_main(surface, window) {
        surface
            .wrap_restore_pending
            .store(true, Ordering::Release);
        log_geometry_on_main(
            "window-wrap",
            surface,
            &format!("action=defer-session-frame-restore reason={reason}"),
        );
        return false;
    }
    window.setFrame_display(saved.as_rect(), true);
    if let Ok(mut saved_frame) = surface.pre_wrap_frame.lock() {
        *saved_frame = None;
    }
    surface
        .wrap_restore_pending
        .store(false, Ordering::Release);
    log_geometry_on_main(
        "window-wrap",
        surface,
        &format!("action=restore-session-frame reason={reason}"),
    );
    true
}

fn clear_window_aspect_on_main(surface: &SurfaceState, reason: &str) -> bool {
    if surface.window_ptr == 0 {
        return false;
    }
    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    // (0, 0) is a real NSWindow property mutation. Never feed it to AppKit while
    // fullscreen or while either transition is in flight.
    if !window_property_mutation_allowed_on_main(surface, window) {
        log_geometry_on_main(
            "window-wrap",
            surface,
            &format!("action=defer-clear reason={reason}"),
        );
        return false;
    }
    window.setContentAspectRatio(NSSize::new(0.0, 0.0));
    surface
        .wrap_constraint_applied
        .store(false, Ordering::Release);
    log_geometry_on_main(
        "window-wrap",
        surface,
        &format!("action=clear reason={reason}"),
    );
    true
}

fn reconcile_window_wrap_on_main(surface: &SurfaceState) {
    if surface.dead.load(Ordering::Acquire) {
        return;
    }
    // Fullscreen state gates NSWindow properties only. Host/layer/FBO geometry
    // remains live and is reconciled before any fullscreen early return below.
    verify_and_repair_geometry_on_main(surface, None, false);
    if surface
        .wrap_reconciling
        .swap(true, Ordering::AcqRel)
    {
        return;
    }

    let reconcile = || {
        if surface.window_ptr == 0 || surface.content_view_ptr == 0 {
            return;
        }
        let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
        if in_fullscreen_or_transition_on_main(surface, window) {
            return;
        }
        let restore_pending = surface.wrap_restore_pending.load(Ordering::Acquire);
        if restore_pending {
            clear_window_aspect_on_main(surface, "playback-ended");
            restore_pre_wrap_frame_on_main(surface, "playback-ended");
        }
        if !surface.wrap_active.load(Ordering::Acquire) {
            if !restore_pending {
                clear_window_aspect_on_main(surface, "inactive");
            }
            return;
        }

        let width = surface.dwidth.load(Ordering::Acquire);
        let height = surface.dheight.load(Ordering::Acquire);
        if width <= 0 || height <= 0 {
            clear_window_aspect_on_main(surface, "dimensions-unknown");
            return;
        }

        let content: &NSView = unsafe { &*(surface.content_view_ptr as *const NSView) };
        let before = content.bounds().size;
        let first_wrap = save_pre_wrap_frame_on_main(surface, window);
        let mut resized = false;
        let mut internal_letterbox = false;
        if before.width > 0.0
            && before.height > 0.0
            && surface.wrap_needs_resize.swap(false, Ordering::AcqRel)
        {
            let aspect = width as f64 / height as f64;
            let minimum = window.contentMinSize();
            let (visible_frame, maximum) = screen_limits(window);
            let (fitted, letterbox) = if first_wrap {
                first_wrap_size(before, aspect, minimum, maximum)
            } else {
                width_preserving_wrap_size(before, aspect, minimum, maximum)
            };
            internal_letterbox = letterbox;
            if (fitted.width - before.width).abs() > 0.01
                || (fitted.height - before.height).abs() > 0.01
            {
                let old_frame = window.frame();
                let centered =
                    centered_frame_within_visible(window, old_frame, fitted, visible_frame);
                // The block may have been queued while windowed. Check again at
                // the exact setFrame call site in case a transition has started.
                if !window_property_mutation_allowed_on_main(surface, window) {
                    surface.wrap_needs_resize.store(true, Ordering::Release);
                    return;
                }
                window.setFrame_display(centered, true);
                resized = true;
            }
        }

        let aspect = normalized_aspect(width, height);
        // setFrame above can synchronously run AppKit code, so the aspect call
        // gets its own fresh transition check rather than sharing the prior one.
        if !window_property_mutation_allowed_on_main(surface, window) {
            surface.wrap_needs_resize.store(true, Ordering::Release);
            return;
        }
        window.setContentAspectRatio(aspect);
        surface
            .wrap_constraint_applied
            .store(true, Ordering::Release);
        if rp_debug_enabled() {
            let after = content.bounds().size;
            let minimum = window.contentMinSize();
            log_geometry_on_main(
                "window-wrap",
                surface,
                &format!(
                    "action=apply ratio={:.0}x{:.0} policy={} resized={} internal_letterbox={} content_before={:.2}x{:.2} content_after={:.2}x{:.2} content_min={:.2}x{:.2}",
                    aspect.width,
                    aspect.height,
                    if first_wrap {
                        if width >= height {
                            "first-wide-width"
                        } else {
                            "first-tall-height"
                        }
                    } else {
                        "width-preserving"
                    },
                    resized,
                    internal_letterbox,
                    before.width,
                    before.height,
                    after.width,
                    after.height,
                    minimum.width,
                    minimum.height,
                ),
            );
        }
    };
    reconcile();
    surface
        .wrap_reconciling
        .store(false, Ordering::Release);
}

fn queue_window_wrap_reconcile(surface: Arc<SurfaceState>) {
    if surface.dead.load(Ordering::Acquire)
        || surface
            .wrap_dispatch_queued
            .swap(true, Ordering::AcqRel)
    {
        return;
    }
    DispatchQueue::main().exec_async(move || {
        surface
            .wrap_dispatch_queued
            .store(false, Ordering::Release);
        if !surface.dead.load(Ordering::Acquire) {
            reconcile_window_wrap_on_main(&surface);
        }
    });
}

fn resume_window_wrap_on_main(surface: &SurfaceState) {
    if surface.dead.load(Ordering::Acquire) || surface.window_ptr == 0 {
        return;
    }
    let window: &NSWindow = unsafe { &*(surface.window_ptr as *const NSWindow) };
    // DidExit is the normal resume point, but evaluate the full predicate here
    // as well. This also protects against a new transition initiated by another
    // observer before this callback runs.
    if in_fullscreen_or_transition_on_main(surface, window) {
        return;
    }
    if surface.wrap_active.load(Ordering::Acquire) {
        surface.wrap_needs_resize.store(true, Ordering::Release);
    }
    reconcile_window_wrap_on_main(surface);
}

fn register_window_observers(host: &HostView, window: &NSWindow) {
    let center = NSNotificationCenter::defaultCenter();
    unsafe {
        center.addObserver_selector_name_object(
            host,
            objc2::sel!(windowWillEnterFullScreen:),
            Some(NSWindowWillEnterFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            host,
            objc2::sel!(windowDidEnterFullScreen:),
            Some(NSWindowDidEnterFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            host,
            objc2::sel!(windowWillExitFullScreen:),
            Some(NSWindowWillExitFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            host,
            objc2::sel!(windowDidExitFullScreen:),
            Some(NSWindowDidExitFullScreenNotification),
            Some(window),
        );
        center.addObserver_selector_name_object(
            host,
            objc2::sel!(windowWillClose:),
            Some(NSWindowWillCloseNotification),
            Some(window),
        );
    }
}

fn remove_window_observers(host: &HostView) {
    let center = NSNotificationCenter::defaultCenter();
    unsafe { center.removeObserver(host) };
}

fn teardown_surface_on_main(
    surface: &Arc<SurfaceState>,
    reason: &str,
    restore_window_frame: bool,
) {
    if surface.dead.swap(true, Ordering::AcqRel) {
        return;
    }
    surface.wrap_active.store(false, Ordering::Release);

    let host_ptr = surface.host_ptr.load(Ordering::Acquire);
    let layer_ptr = surface.layer_ptr.load(Ordering::Acquire);
    if layer_ptr != 0 {
        let layer: &VideoLayer = unsafe { &*(layer_ptr as *const VideoLayer) };
        layer.ivars().callback.dead.store(true, Ordering::Release);
    }

    let window_cleanup_deferred = if restore_window_frame && surface.window_ptr != 0 {
        let window: &NSWindow =
            unsafe { &*(surface.window_ptr as *const NSWindow) };
        if in_fullscreen_or_transition_on_main(surface, window) {
            // Register before removing the host's observers. The independent
            // helper owns an Arc<SurfaceState>, so the saved frame and transition
            // flags remain alive after the host and MacosSurface are gone.
            register_post_fullscreen_cleanup_on_main(surface.clone());
            true
        } else {
            let had_saved_frame = surface
                .pre_wrap_frame
                .lock()
                .map(|frame| frame.is_some())
                .unwrap_or(false);
            let cleared = clear_window_aspect_on_main(surface, reason);
            let restored = restore_pre_wrap_frame_on_main(surface, reason);
            if !cleared || (had_saved_frame && !restored) {
                // A setter above can synchronously run AppKit. If that started a
                // fullscreen transition, preserve the still-pending work rather
                // than discarding it at the end of teardown.
                register_post_fullscreen_cleanup_on_main(surface.clone());
                true
            } else {
                false
            }
        }
    } else {
        // windowWillClose needs no cosmetic cleanup. In particular, never touch
        // a closing fullscreen window just to reset a constraint it cannot reuse.
        false
    };

    surface.wrap_needs_resize.store(false, Ordering::Release);
    if !window_cleanup_deferred {
        discard_window_wrap_state(surface);
    }

    if host_ptr != 0 {
        let host: &HostView = unsafe { &*(host_ptr as *const HostView) };
        remove_window_observers(host);
    }
    if layer_ptr != 0 {
        let layer: &VideoLayer = unsafe { &*(layer_ptr as *const VideoLayer) };
        // Free mpv_render_context while the host hierarchy still retains the
        // layer. This unregisters and drains the update callback before either
        // native view can be released.
        drop(layer.ivars().render.lock().unwrap().take());
    }
    if host_ptr != 0 {
        let host: &HostView = unsafe { &*(host_ptr as *const HostView) };
        // Safe during fullscreen: this changes only the content-view hierarchy
        // and does not issue an NSWindow property mutation.
        host.removeFromSuperview();
    }
    surface.host_ptr.store(0, Ordering::Release);
    surface.layer_ptr.store(0, Ordering::Release);
}

/// The macOS surface handle. Native pointers and cleanup ownership live in the
/// shared state so explicit detach and NSWindowWillClose use one idempotent path.
pub struct MacosSurface {
    state: Arc<SurfaceState>,
}

impl VideoSurface for MacosSurface {
    fn set_rect(&self, _x: i32, _y: i32, _w: i32, _h: i32) {
        // No-op: the host view autoresizes with the content view (see attach), so
        // the video always fills the window without explicit DOM-driven geometry.
    }

    fn video_file_started(&self) {
        self.state.dwidth.store(0, Ordering::Release);
        self.state.dheight.store(0, Ordering::Release);
        self.state.wrap_active.store(false, Ordering::Release);
        self.state
            .wrap_restore_pending
            .store(false, Ordering::Release);
        self.state.wrap_has_applied.store(false, Ordering::Release);
        if let Ok(mut saved) = self.state.pre_wrap_frame.lock() {
            *saved = None;
        }
        self.state
            .wrap_needs_resize
            .store(true, Ordering::Release);
        queue_window_wrap_reconcile(self.state.clone());
    }

    fn video_dimensions_changed(&self, width: i64, height: i64) {
        if width <= 0 || height <= 0 {
            return;
        }
        let old_width = self.state.dwidth.load(Ordering::Acquire);
        let old_height = self.state.dheight.load(Ordering::Acquire);
        let aspect_changed = old_width <= 0
            || old_height <= 0
            || (old_width as i128 * height as i128)
                != (width as i128 * old_height as i128);
        self.state.dwidth.store(width, Ordering::Release);
        self.state.dheight.store(height, Ordering::Release);
        self.state.wrap_active.store(true, Ordering::Release);
        if aspect_changed
            || !self
                .state
                .wrap_constraint_applied
                .load(Ordering::Acquire)
        {
            self.state
                .wrap_needs_resize
                .store(true, Ordering::Release);
        }
        queue_window_wrap_reconcile(self.state.clone());
    }

    fn video_playback_ended(&self) {
        self.state.wrap_active.store(false, Ordering::Release);
        self.state
            .wrap_restore_pending
            .store(true, Ordering::Release);
        // A later keep-open replay is a subsequent wrap in this player session,
        // so it uses the width-preserving policy after this frame restoration.
        self.state
            .wrap_needs_resize
            .store(true, Ordering::Release);
        queue_window_wrap_reconcile(self.state.clone());
    }

    fn detach(&self) {
        let state = self.state.clone();
        let teardown = move || teardown_surface_on_main(&state, "detach", true);
        // detach normally runs off the main thread (async commands / Player drop);
        // exec_sync onto the main queue preserves the ordering there. If a future
        // caller is already ON the main thread, run inline instead - dispatch_sync
        // onto the queue we are running on would self-deadlock.
        if MainThreadMarker::new().is_some() {
            teardown();
        } else {
            DispatchQueue::main().exec_sync(teardown);
        }
    }
}

/// Build the macOS video surface on the main thread and bind it to mpv. Tauri's
/// `with_webview` callback supplies the exact NSWindow and WKWebView for this app
/// window, so setup never guesses from NSApplication.keyWindow/mainWindow.
/// The render-API surface needs nothing set up before mpv is initialized.
pub fn surface_pre_init<R: Runtime>(_app: &AppHandle<R>) -> Result<PreInit, String> {
    Ok(PreInit {
        options: Vec::new(),
        handle: 0,
    })
}

pub fn surface_attach<R: Runtime>(
    app: &AppHandle<R>,
    mpv: Arc<Mpv>,
    _handle: usize,
) -> Result<Arc<dyn VideoSurface>, String> {
    let webview_window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or("no app webview window for the video surface")?;
    let (tx, rx) = std::sync::mpsc::channel::<
        Result<(usize, usize, Arc<SurfaceState>), String>,
    >();
    webview_window
        .with_webview(move |webview| {
            let window_ptr = webview.ns_window() as usize;
            let webview_ptr = webview.inner() as usize;
            let _ = tx.send(setup_on_main(mpv, window_ptr, webview_ptr));
        })
        .map_err(|e| format!("could not access the native webview: {e}"))?;
    let (_host_view_ptr, layer_ptr, state) = rx
        .recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "timed out setting up the video surface".to_string())??;

    // Wait for the CA layer's first draw to create the mpv RenderContext BEFORE we
    // return - so mpv's vo=libmpv finds it the moment a file is loaded. Without
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

    Ok(Arc::new(MacosSurface { state }))
}

// ---- Main-thread surface setup ------------------------------------------
fn top_level_content_sibling(content_ptr: usize, webview_ptr: usize) -> usize {
    let mut current_ptr = webview_ptr;
    // WKWebView may be wrapped by one or more Wry/Tao views. Walk upward until
    // the current view is a direct child of NSWindow.contentView.
    for _ in 0..16 {
        if current_ptr == 0 || current_ptr == content_ptr {
            return 0;
        }
        let current: &NSView = unsafe { &*(current_ptr as *const NSView) };
        let parent_ptr = unsafe { current.superview() }
            .map(|view| Retained::as_ptr(&view) as usize)
            .unwrap_or(0);
        if parent_ptr == content_ptr {
            return current_ptr;
        }
        current_ptr = parent_ptr;
    }
    0
}

/// Returns (host_view_ptr, layer_ptr, shared surface state).
fn setup_on_main(
    mpv: Arc<Mpv>,
    window_ptr: usize,
    webview_ptr: usize,
) -> Result<(usize, usize, Arc<SurfaceState>), String> {
    rp_log("setup_on_main: start");
    let mtm = MainThreadMarker::new().ok_or("setup must run on the main thread")?;
    if window_ptr == 0 || webview_ptr == 0 {
        return Err("Tauri returned a null native window or webview".to_string());
    }
    let ns_window: &NSWindow = unsafe { &*(window_ptr as *const NSWindow) };
    // A newly attached live surface supersedes any cleanup left by an older
    // surface on the same window. It will observe and reconcile the eventual
    // DidExit itself, so the old one-shot must not mutate the new session later.
    // Carry its transition state forward in case reattach occurs after WillExit
    // and after AppKit has already cleared the fullscreen style bit.
    let inherited_fullscreen_state =
        cancel_post_fullscreen_cleanup_on_main(window_ptr, "surface-reattach");
    let webview: &NSView = unsafe { &*(webview_ptr as *const NSView) };
    let content = ns_window.contentView().ok_or("no content view")?;
    let content_ptr = Retained::as_ptr(&content) as usize;
    let webview_sibling_ptr = top_level_content_sibling(content_ptr, webview_ptr);
    let backing_scale = ns_window.backingScaleFactor();
    let bounds = content.bounds();
    let state = SurfaceState::new(
        window_ptr,
        content_ptr,
        webview_ptr,
        webview_sibling_ptr,
    );
    if let Some((session_active, enter_in_flight, exit_in_flight)) =
        inherited_fullscreen_state
    {
        state
            .fullscreen_session_active
            .store(session_active, Ordering::Release);
        state
            .fullscreen_enter_in_flight
            .store(enter_in_flight, Ordering::Release);
        state
            .fullscreen_exit_in_flight
            .store(exit_in_flight, Ordering::Release);
    }
    if ns_window
        .styleMask()
        .contains(NSWindowStyleMask::FullScreen)
    {
        state
            .fullscreen_session_active
            .store(true, Ordering::Release);
    }
    rp_log(&format!(
        "setup_on_main: exact Tauri window=0x{window_ptr:x} webview=0x{webview_ptr:x} content=0x{content_ptr:x} sibling=0x{webview_sibling_ptr:x} content {}x{} scale {}",
        bounds.size.width as i32,
        bounds.size.height as i32,
        backing_scale
    ));

    // Host view (layer-hosting) filling the content view in POINTS. Using the
    // content bounds verbatim preserves a non-zero bounds origin if AppKit/Wry
    // ever supplies one; contentsScale is applied only to the GL target below.
    let frame = bounds;
    let layer = VideoLayer::new(mpv, state.clone());
    unsafe { layer.setContentsScale(backing_scale) };
    // Draw only when there's a new frame (mpv's update callback pokes
    // setNeedsDisplay) or the bounds change - not 60fps continuously. This also
    // makes CA reallocate the GL drawable to the new size on resize, so the
    // video always renders at native resolution instead of a stretched texture.
    layer.setAsynchronous(false);
    unsafe { layer.setNeedsDisplayOnBoundsChange(true) };
    layer.setAutoresizingMask(
        CAAutoresizingMask::LayerWidthSizable | CAAutoresizingMask::LayerHeightSizable,
    );

    // Layer-BACKED host that re-renders the video layer on every resize step.
    let host = HostView::new(mtm, frame, layer.clone(), state.clone());
    state
        .host_ptr
        .store(Retained::as_ptr(&host) as usize, Ordering::Release);
    host.setWantsLayer(true);
    layer.setFrame(host.bounds());
    unsafe {
        layer.setBounds(NSRect::new(NSPoint::new(0.0, 0.0), host.bounds().size));
    }

    // Configure autoresizing before insertion, then set the frame again after
    // insertion. This avoids an attach-time snapshot becoming permanent if Wry
    // lays out the content hierarchy in the same run-loop turn.
    unsafe {
        content.setAutoresizesSubviews(true);
        host.setAutoresizingMask(
            objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable
                | objc2_app_kit::NSAutoresizingMaskOptions::ViewHeightSizable,
        );
    }

    // Add the video layer as a sublayer of the host's backing layer.
    let backing: *mut AnyObject = unsafe { msg_send![&*host, layer] };
    if !backing.is_null() {
        let sublayer: &CALayer = &layer;
        unsafe {
            let _: () = msg_send![backing, addSublayer: sublayer];
        }
    }

    // Insert immediately BELOW the WKWebView's top-level content sibling. Passing
    // None here made the ordering dependent on every other framework-owned view.
    let sibling = if webview_sibling_ptr != 0 {
        Some(unsafe { &*(webview_sibling_ptr as *const NSView) })
    } else {
        None
    };
    content.addSubview_positioned_relativeTo(&host, NSWindowOrderingMode::Below, sibling);
    host.setFrame(content.bounds());
    register_window_observers(&host, ns_window);
    log_geometry_on_main(
        "attach",
        &state,
        &format!(
            "insertion=below-webview-sibling webview.direct_parent=0x{:x}",
            unsafe { webview.superview() }
                .map(|view| Retained::as_ptr(&view) as usize)
                .unwrap_or(0)
        ),
    );

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
        state,
    ))
}
