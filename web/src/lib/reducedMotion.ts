// Whether non-essential motion should be suppressed right now, honoring BOTH the
// in-app Motion setting (root `data-motion`) and, when that's "system", the OS
// `prefers-reduced-motion`. Read this before starting any JS-driven animation
// (timers, rotations) - the CSS layer is already damped globally in theme.css,
// but a JS timer that swaps content is still motion the user asked to avoid.
export function prefersReducedMotion(): boolean {
  const mode =
    typeof document !== "undefined"
      ? document.documentElement.dataset.motion
      : undefined;
  if (mode === "reduced") return true;
  if (mode === "normal") return false;
  // "system" or unset → follow the OS preference.
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
