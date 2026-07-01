// Freeze all CSS keyframe animations while the app window is hidden —
// minimized, on another Space, or fully covered (WKWebView propagates NSWindow
// occlusion into `document.hidden`, and browsers do the equivalent for tabs).
// theme.css keys off `:root[data-suspended]` with `animation-play-state: paused`.
// Transitions and JS-driven motion are unaffected; this only parks looping
// keyframes so a hidden window costs ~zero render CPU.
export function installSuspendOnHidden(doc: Document = document): () => void {
  const apply = () => {
    if (doc.hidden) {
      doc.documentElement.dataset.suspended = "";
    } else {
      delete doc.documentElement.dataset.suspended;
    }
  };
  apply();
  doc.addEventListener("visibilitychange", apply);
  return () => {
    doc.removeEventListener("visibilitychange", apply);
    delete doc.documentElement.dataset.suspended;
  };
}
