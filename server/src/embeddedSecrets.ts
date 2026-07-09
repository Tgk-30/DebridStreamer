// Build-time embedded provider secrets (the "friends" self-host tier - they run
// a server with some keys baked in: omdb / tmdb / real_debrid / all_debrid /
// premiumize / torbox, per build).
//
// Encryption: AES-256-GCM (authenticated) with an scrypt-derived key. The build
// script (scripts/embed_secrets.mjs) writes only ciphertext + salt + iv + auth
// tag + KDF params to embedded-secrets.json; the plaintext keys never touch disk
// in the build or the repo. At runtime the server decrypts the blob into memory
// once, using DS_EMBED_PASSPHRASE.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  SECURITY REALITY - read before trusting it.
//
// Encryption-at-rest in a build can only protect secrets from people who do NOT
// control the machine that runs it (the friend-operator's own users, and casual
// `strings`/grep inspection). It CANNOT protect them from the operator who runs
// the server: to use a key the server must decrypt it, so whoever controls the
// server can recover it (read process memory, attach a debugger, or watch the
// outbound request - the key rides in the URL/headers). No cipher changes this.
//   • DS_EMBED_PASSPHRASE supplied at RUNTIME (e.g. delivered by a broker you
//     control, and revocable) → the blob is useless without a passphrase you
//     never bake in. This is the strong option.
//   • The baked DEFAULT passphrase (opt-in only) → BEST-EFFORT obfuscation: the
//     shipped files alone decrypt it. A determined operator extracts the keys.
// For keys that must be unrecoverable by the recipient, don't ship them - proxy
// those calls through infrastructure you control. See docs/KEYS.md.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const VERSION = 1;
const KEY_LEN = 32; // AES-256
// scrypt cost. Stored in the blob so it can be raised later without breaking old
// blobs. N must be a power of two; maxmem is sized for the largest supported N.
const DEFAULT_KDF = { N: 1 << 16, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** Providers whose keys may be embedded. Ids match the server's
 *  CredentialProvider names so a future shared resolver maps them 1:1. */
export const EMBEDDABLE_PROVIDERS = [
  "omdb",
  "tmdb",
  "real_debrid",
  "all_debrid",
  "premiumize",
  "torbox",
] as const;
export type EmbeddableProvider = (typeof EMBEDDABLE_PROVIDERS)[number];

interface KdfParams {
  N: number;
  r: number;
  p: number;
}

export interface EncryptedSecrets {
  v: number;
  /** Build profile this blob was generated for (family|friends|public). */
  profile: string;
  kdf: KdfParams;
  salt: string; // base64
  iv: string; // base64 (12-byte GCM nonce)
  tag: string; // base64 (16-byte GCM auth tag)
  data: string; // base64 AES-256-GCM ciphertext of JSON {provider: key}
}

/** Reject out-of-range KDF params - guards against a tampered/swapped blob that
 *  sets a DoS-grade `N` (memory/CPU exhaustion) or a trivially-weak one. */
function validateKdf(kdf: KdfParams): void {
  const { N, r, p } = kdf ?? {};
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new Error("Invalid KDF params");
  }
  // N: power of two in [2^14, 2^20]; r,p bounded.
  if (N < 1 << 14 || N > 1 << 20 || (N & (N - 1)) !== 0) throw new Error("Invalid KDF N");
  if (r < 1 || r > 32) throw new Error("Invalid KDF r");
  if (p < 1 || p > 16) throw new Error("Invalid KDF p");
}

function deriveKey(passphrase: string, salt: Buffer, kdf: KdfParams): Buffer {
  validateKdf(kdf);
  return scryptSync(passphrase, salt, KEY_LEN, { ...kdf, maxmem: SCRYPT_MAXMEM });
}

/** Encrypt a {provider: key} map under a passphrase (build-time helper, also
 *  used by the build script). */
export function encryptSecrets(
  secrets: Record<string, string>,
  passphrase: string,
  profile: string,
  kdf: KdfParams = DEFAULT_KDF,
): EncryptedSecrets {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, kdf);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(secrets), "utf8")),
    cipher.final(),
  ]);
  return {
    v: VERSION,
    profile,
    kdf,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ct.toString("base64"),
  };
}

/** Decrypt a blob. Throws on a wrong passphrase or any tampering (GCM auth tag
 *  verification fails closed). */
export function decryptSecrets(
  blob: EncryptedSecrets,
  passphrase: string,
): Record<string, string> {
  if (blob.v !== VERSION) throw new Error("Unsupported embedded-secrets version");
  const kdf = blob.kdf ?? DEFAULT_KDF;
  const salt = Buffer.from(blob.salt, "base64");
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const key = deriveKey(passphrase, salt, kdf);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(), // throws if the tag/passphrase is wrong
  ]);
  return JSON.parse(pt.toString("utf8")) as Record<string, string>;
}

// ── Runtime loading ──────────────────────────────────────────────────────────

// Opt-in only (DS_EMBED_ALLOW_DEFAULT_PASSPHRASE=1). Using this = BEST-EFFORT
// obfuscation: the shipped files alone decrypt the blob. Prefer a real
// DS_EMBED_PASSPHRASE, ideally supplied at runtime and not baked in.
const DEFAULT_PASSPHRASE = "ds-embed-default-v1-not-a-real-secret";

/** The passphrase to decrypt with, or null when none is available (no env
 *  passphrase and the weak default was not explicitly opted into). */
function resolvePassphrase(): string | null {
  const env = process.env.DS_EMBED_PASSPHRASE?.trim();
  if (env != null && env.length > 0) return env;
  if (process.env.DS_EMBED_ALLOW_DEFAULT_PASSPHRASE === "1") return DEFAULT_PASSPHRASE;
  return null;
}

function blobPath(): string {
  const env = process.env.DS_EMBED_SECRETS_FILE?.trim();
  if (env != null && env.length > 0) return env;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "embedded-secrets.json");
}

let cache: { secrets: Record<string, string>; profile: string } | null | undefined;
let warned = false;

/** Sanitized one-time warning (never includes secret material). */
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[embedded-secrets] ${message}`);
}

/** Load + decrypt the embedded secrets once. Returns {} (and a null profile)
 *  when no blob is present (the default / public build) or on any error - the
 *  server simply behaves as if nothing was embedded, and logs a sanitized
 *  warning so a misconfiguration is visible without leaking the key. */
export function loadEmbeddedSecrets(): { secrets: Record<string, string>; profile: string | null } {
  if (cache !== undefined) {
    return cache == null ? { secrets: {}, profile: null } : cache;
  }
  const path = blobPath();
  if (!existsSync(path)) {
    cache = null;
    return { secrets: {}, profile: null };
  }
  const pass = resolvePassphrase();
  if (pass == null) {
    warnOnce(
      "an embedded-secrets blob is present but DS_EMBED_PASSPHRASE is not set " +
        "(and DS_EMBED_ALLOW_DEFAULT_PASSPHRASE!=1). Embedded keys are disabled.",
    );
    cache = null;
    return { secrets: {}, profile: null };
  }
  try {
    const blob = JSON.parse(readFileSync(path, "utf8")) as EncryptedSecrets;
    const secrets = decryptSecrets(blob, pass);
    cache = { secrets, profile: blob.profile };
    return cache;
  } catch {
    warnOnce(
      "failed to decrypt the embedded-secrets blob (wrong DS_EMBED_PASSPHRASE, " +
        "tampered, or malformed). Embedded keys are disabled.",
    );
    cache = null;
    return { secrets: {}, profile: null };
  }
}

/** The embedded key for a provider, or null when not embedded in this build. */
export function embeddedSecret(provider: EmbeddableProvider): string | null {
  const key = loadEmbeddedSecrets().secrets[provider]?.trim();
  return key != null && key.length > 0 ? key : null;
}

/** Test-only: reset the in-memory cache + warning latch. */
export function __resetEmbeddedSecretsCache(): void {
  cache = undefined;
  warned = false;
}
