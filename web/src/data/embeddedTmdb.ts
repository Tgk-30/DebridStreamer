// Build-time embedded TMDB key (Mode 3 - serverless limited distribution).
//
// `TMDB_EMBED_KEY` (a NON-VITE build env, so Vite does NOT auto-inline it as a
// plaintext string) is XOR'd + base64'd at build time by vite.config.ts into the
// `__TMDB_EMBED__` define, so the key's plaintext never appears in the JS bundle.
// This module deobfuscates it at runtime so a limited-distribution build can ship
// a working catalog with zero user setup - the biggest onboarding cliff today is
// that a fresh install shows only fixtures until the user sources a TMDB key.
//
// Mirrors embeddedOmdb.ts exactly. The default (no key baked in) leaves the
// mechanism dormant and behaviour unchanged: precedence stays user key ->
// (nothing) -> VITE_TMDB_KEY dev fallback.
//
// SECURITY REALITY: this only defeats casual bundle inspection. A client that
// calls TMDB directly still sends the key in the request URL, so anyone who can
// watch the client's own network traffic can recover it - embedding a key in a
// client build is NEVER truly untrackable, and all clients share one key's rate
// limit. For a key that genuinely cannot be extracted, run the self-hosted
// server (its TMDB broker makes the request so the key never leaves the server)
// and ship Server-Mode clients.

declare const __TMDB_EMBED__: string;

const PAD = "ds-tmdb-embed-v1";

/** Deobfuscate the build-time embedded TMDB key, or "" when none was baked in
 *  (the default) or in any non-browser/test context. */
export function embeddedTmdbKey(): string {
  try {
    // `typeof` is safe even when the define was never injected (tests/SSR).
    const blob = typeof __TMDB_EMBED__ === "string" ? __TMDB_EMBED__ : "";
    if (blob.length === 0) return "";
    if (typeof atob !== "function") return "";
    const bytes = atob(blob);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      out += String.fromCharCode(
        bytes.charCodeAt(i) ^ PAD.charCodeAt(i % PAD.length),
      );
    }
    return out;
  } catch {
    return "";
  }
}
