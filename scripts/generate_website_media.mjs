#!/usr/bin/env node
// TOMBSTONE — do not regenerate placeholders over real captures.
//
// website/media/*.png used to be drawn placeholder mockups produced by this
// script. As of 2026-07 they are REAL screenshots of the running app
// (Discover with live TMDB data at 1440x848 and 768x1196, Settings at
// 390x792), captured with scripts/capture_website_media.mjs and compressed
// with pngquant. Running the old generator would silently replace the real
// product imagery with wireframes, so it now refuses.
//
// To refresh the media: see scripts/capture_website_media.mjs (requires a
// dev server, playwright-core, and a TMDB key in the environment), then
// `pngquant --quality 65-90 --speed 1` each capture into website/media/ and
// keep scripts/check_website_static.mjs byte pins satisfied.

console.error(
  "website/media now holds REAL app screenshots — refusing to overwrite them" +
    " with drawn placeholders. Use scripts/capture_website_media.mjs instead.",
);
process.exit(1);
