import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetEmbeddedSecretsCache,
  decryptSecrets,
  embeddedSecret,
  encryptSecrets,
  loadEmbeddedSecrets,
} from "../src/embeddedSecrets.js";

afterEach(() => {
  delete process.env.DS_EMBED_SECRETS_FILE;
  delete process.env.DS_EMBED_PASSPHRASE;
  __resetEmbeddedSecretsCache();
});

describe("embedded-secrets AES-256-GCM", () => {
  it("round-trips an encrypted secret map", () => {
    const blob = encryptSecrets({ omdb: "abc123", tmdb: "def456" }, "pass", "friends");
    expect(blob.v).toBe(1);
    expect(blob.profile).toBe("friends");
    expect(decryptSecrets(blob, "pass")).toEqual({ omdb: "abc123", tmdb: "def456" });
  });

  it("never stores the plaintext key in the blob", () => {
    const blob = encryptSecrets({ omdb: "PLAINTEXT-SECRET-OMDB" }, "pass", "friends");
    expect(JSON.stringify(blob)).not.toContain("PLAINTEXT-SECRET-OMDB");
  });

  it("fails closed on a wrong passphrase (GCM auth)", () => {
    const blob = encryptSecrets({ omdb: "abc123" }, "right", "friends");
    expect(() => decryptSecrets(blob, "wrong")).toThrow();
  });

  it("fails closed on tampered ciphertext", () => {
    const blob = encryptSecrets({ omdb: "abc123" }, "pass", "friends");
    const flipped = Buffer.from(blob.data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecrets({ ...blob, data: flipped.toString("base64") }, "pass")).toThrow();
  });

  it("rejects out-of-range KDF params before running scrypt (anti-DoS)", () => {
    const blob = encryptSecrets({ omdb: "x" }, "pass", "friends");
    // DoS-grade N must be rejected outright (never handed to scrypt).
    expect(() => decryptSecrets({ ...blob, kdf: { N: 1 << 28, r: 8, p: 1 } }, "pass")).toThrow();
    // Too-weak N, and a non-power-of-two N, are both rejected.
    expect(() => decryptSecrets({ ...blob, kdf: { N: 1024, r: 8, p: 1 } }, "pass")).toThrow();
    expect(() => decryptSecrets({ ...blob, kdf: { N: 65535, r: 8, p: 1 } }, "pass")).toThrow();
  });

  it("loadEmbeddedSecrets decrypts a blob file and exposes per-provider keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-embed-"));
    const file = join(dir, "embedded-secrets.json");
    const blob = encryptSecrets({ omdb: "live-omdb-key", torbox: "live-torbox" }, "pp", "friends");
    writeFileSync(file, JSON.stringify(blob));
    process.env.DS_EMBED_SECRETS_FILE = file;
    process.env.DS_EMBED_PASSPHRASE = "pp";
    __resetEmbeddedSecretsCache();

    expect(loadEmbeddedSecrets().profile).toBe("friends");
    expect(embeddedSecret("omdb")).toBe("live-omdb-key");
    expect(embeddedSecret("torbox")).toBe("live-torbox");
    expect(embeddedSecret("tmdb")).toBeNull();
  });

  it("returns nothing (no throw) when no blob file exists", () => {
    process.env.DS_EMBED_SECRETS_FILE = "/nonexistent/embedded-secrets.json";
    __resetEmbeddedSecretsCache();
    expect(loadEmbeddedSecrets()).toEqual({ secrets: {}, profile: null });
    expect(embeddedSecret("omdb")).toBeNull();
  });

  it("behaves as unembedded on a wrong runtime passphrase (no throw to callers)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-embed-"));
    const file = join(dir, "embedded-secrets.json");
    writeFileSync(file, JSON.stringify(encryptSecrets({ omdb: "x" }, "correct", "friends")));
    process.env.DS_EMBED_SECRETS_FILE = file;
    process.env.DS_EMBED_PASSPHRASE = "incorrect";
    __resetEmbeddedSecretsCache();
    expect(embeddedSecret("omdb")).toBeNull();
  });
});
