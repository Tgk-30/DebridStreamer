import { afterEach, describe, expect, it } from "vitest";
import { embeddedOmdbKey } from "./embeddedOmdb";

// Mirror the build-time obfuscation in vite.config.ts so the test can stand in
// for the Vite `define` (which isn't applied under vitest).
const PAD = "ds-omdb-embed-v1";
function obfuscate(plain: string): string {
  const bytes = Array.from(plain).map(
    (ch, i) => ch.charCodeAt(0) ^ PAD.charCodeAt(i % PAD.length),
  );
  return Buffer.from(bytes).toString("base64");
}

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.__OMDB_EMBED__;
});

describe("embeddedOmdbKey", () => {
  it("returns '' when no key is embedded", () => {
    expect(embeddedOmdbKey()).toBe("");
  });

  it("deobfuscates a build-time embedded key (roundtrip)", () => {
    g.__OMDB_EMBED__ = obfuscate("abc123-XYZ_key");
    expect(embeddedOmdbKey()).toBe("abc123-XYZ_key");
  });

  it("never stores the key as plaintext in the obfuscated blob", () => {
    const blob = obfuscate("supersecretkey");
    expect(blob).not.toContain("supersecretkey");
  });
});
