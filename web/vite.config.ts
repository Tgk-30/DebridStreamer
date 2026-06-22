/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build-time OMDb "embedded key" obfuscation (Mode 3 — serverless limited
// distribution). `OMDB_EMBED_KEY` is a NON-VITE env (so Vite does not auto-inline
// it as plaintext); we XOR + base64 it here so only the obfuscated bytes land in
// the bundle. NOTE: this only defeats casual bundle inspection — a client calling
// OMDb directly still sends the key in the request URL, so it is NOT untrackable.
// For a truly hidden key, use the server's DS_SERVER_OMDB_API_KEY proxy.
const OMDB_OBFUSCATION_PAD = "ds-omdb-embed-v1";
function obfuscateOmdbKey(plain: string): string {
  if (!plain) return "";
  const bytes = Array.from(plain).map((ch, i) =>
    ch.charCodeAt(0) ^ OMDB_OBFUSCATION_PAD.charCodeAt(i % OMDB_OBFUSCATION_PAD.length),
  );
  return Buffer.from(bytes).toString("base64");
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __OMDB_EMBED__: JSON.stringify(obfuscateOmdbKey(process.env.OMDB_EMBED_KEY ?? "")),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
