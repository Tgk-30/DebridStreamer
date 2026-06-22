// Build-time embedded OMDb key (Mode 3 — serverless limited distribution).
//
// `OMDB_EMBED_KEY` (a NON-VITE build env, so Vite does NOT auto-inline it as a
// plaintext string) is XOR'd + base64'd at build time by vite.config.ts into the
// `__OMDB_EMBED__` define, so the key's plaintext never appears in the JS bundle.
// This module deobfuscates it at runtime to build the OMDb client.
//
// ⚠️ SECURITY REALITY: this only defeats casual bundle inspection. A client that
// calls OMDb directly still sends the key in the request URL, so anyone who can
// watch the client's own network traffic can recover it — embedding a key in a
// client build is NEVER truly untrackable. For a key that genuinely cannot be
// extracted, run the self-hosted server with DS_SERVER_OMDB_API_KEY and ship
// Server-Mode clients: the server makes the OMDb request and the key never
// leaves the server. See docs/OMDB.md.

declare const __OMDB_EMBED__: string;

const PAD = "ds-omdb-embed-v1";

/** Deobfuscate the build-time embedded OMDb key, or "" when none was baked in
 *  (the default) or in any non-browser/test context. */
export function embeddedOmdbKey(): string {
  try {
    // `typeof` is safe even when the define was never injected (tests/SSR).
    const blob = typeof __OMDB_EMBED__ === "string" ? __OMDB_EMBED__ : "";
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
