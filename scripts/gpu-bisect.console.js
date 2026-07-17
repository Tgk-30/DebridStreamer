/* GPU bisect - paste this whole file into the desktop app's devtools console.
 *
 * Toggle the GPU-expensive CSS features on and off one at a time while watching
 * Activity Monitor (the app's renderer process + WindowServer) to find what is
 * actually burning. Every toggle is reversible and touches nothing on disk.
 *
 * NOTE: run this in the REAL app (right-click > Inspect Element in a dev build).
 * The Claude browser preview reports visibilityState=hidden, which freezes all
 * CSS animations - measurements there are meaningless.
 *
 * Usage:
 *   gpu.status()          what is currently killed
 *   gpu.kill("blur")      disable a feature      gpu.restore("blur") re-enable
 *   gpu.kill("all")       nuclear: everything    gpu.restore("all")
 *   gpu.fps()             frame meter overlay    gpu.fps() again to remove
 *   gpu.reset()           restore everything
 *
 * Suspects (from the 2026-07-15 render-path audit; see docs/ai-scoreboard.md):
 *   blur     every backdrop-filter (nav rail 24px, detail 28px, glass-*)
 *   anim     pause ALL CSS animations (the biggest single lever)
 *   hero     the Discover hero: Ken Burns + crossfade (4s of every 7s, full-bleed
 *            behind the nav rail blur; keeps running under the Detail overlay)
 *   shimmer  skeleton/poster shimmers (background-position = repaint per frame;
 *            DetailHero + CastRail run forever behind loaded images)
 *   orbs     aurora glow orbs (150-160px blurs; static since the 14-16% CPU fix,
 *            kill to confirm their residual raster cost)
 *   nav      just the nav rail blur (historical top scroll-jank source at 44px)
 *   trans    all transitions (hover box-shadow/filter sweeps across card grids)
 */
(() => {
  const RULES = {
    blur: `*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
    anim: `*, *::before, *::after { animation-play-state: paused !important; }`,
    hero: `.hero, .hero * , .hero *::before, .hero *::after { animation: none !important; }`,
    shimmer: `[class*="skel"], .cast-photo, .detail-hero-poster { animation: none !important; }`,
    orbs: `.aurora-glow::before, .aurora-glow::after { filter: none !important; background: none !important; }`,
    nav: `.nav-rail { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
    trans: `*, *::before, *::after { transition: none !important; }`,
  };
  const ALL = Object.keys(RULES);
  const live = () => ALL.filter((k) => document.getElementById(`gpu-bisect-${k}`));
  const kill = (key) => {
    if (key === "all") return ALL.forEach(kill);
    if (!RULES[key]) return console.warn(`unknown key; use one of: all ${ALL.join(" ")}`);
    if (document.getElementById(`gpu-bisect-${key}`)) return console.log(`${key}: already killed`);
    const s = document.createElement("style");
    s.id = `gpu-bisect-${key}`;
    s.textContent = RULES[key];
    document.head.appendChild(s);
    console.log(`${key}: KILLED   (killed now: ${live().join(", ")})`);
  };
  const restore = (key) => {
    if (key === "all") return ALL.forEach(restore);
    document.getElementById(`gpu-bisect-${key}`)?.remove();
    console.log(`${key}: restored (killed now: ${live().join(", ") || "none"})`);
  };
  let meter = null;
  const fps = () => {
    if (meter) {
      cancelAnimationFrame(meter.raf);
      meter.el.remove();
      meter = null;
      return console.log("fps meter removed");
    }
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:99999;background:#000c;color:#0f0;" +
      "font:12px/1.4 monospace;padding:6px 10px;border-radius:6px;pointer-events:none";
    document.body.appendChild(el);
    let frames = 0, long = 0, last = performance.now(), tick = last;
    const loop = (now) => {
      frames++;
      if (now - tick > 20) long++;
      tick = now;
      if (now - last >= 1000) {
        el.textContent = `${frames} fps  |  ${long} long frames  |  killed: ${live().join(",") || "none"}`;
        frames = 0; long = 0; last = now;
      }
      meter.raf = requestAnimationFrame(loop);
    };
    meter = { el, raf: requestAnimationFrame(loop) };
  };
  window.gpu = {
    kill,
    restore,
    reset: () => restore("all"),
    status: () => console.log(`killed: ${live().join(", ") || "none"}`),
    fps,
  };
  console.log(`gpu bisect ready. keys: all ${ALL.join(" ")}. Try gpu.kill("anim") first - it is the biggest single lever.`);
})();
