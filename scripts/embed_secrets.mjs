#!/usr/bin/env node
// Build-time embedded-secrets generator (the "friends" self-host tier).
//
// Encrypts the provider keys you want baked into a friends build (omdb / tmdb /
// real_debrid / all_debrid / premiumize / torbox - whichever you provide) into
// server/embedded-secrets.json using AES-256-GCM with an scrypt-derived key. The
// PLAINTEXT keys are read from env and never written to disk or printed. The
// runtime (server/src/embeddedSecrets.ts) decrypts the blob in memory using the
// SAME passphrase.
//
// Usage (friends build - strong: a real passphrase, ideally delivered to the
// friend's server at runtime, not baked into the image):
//   DS_BUILD_PROFILE=friends \
//   DS_EMBED_PASSPHRASE='a-strong-passphrase-you-keep' \
//   OMDB_EMBED_KEY=... TMDB_EMBED_KEY=... REALDEBRID_EMBED_KEY=... \
//   ALLDEBRID_EMBED_KEY=... PREMIUMIZE_EMBED_KEY=... TORBOX_EMBED_KEY=... \
//   node scripts/embed_secrets.mjs
//
// Without DS_EMBED_PASSPHRASE the script refuses to bake keys unless you opt into
// the weak baked-default passphrase with DS_EMBED_ALLOW_DEFAULT_PASSPHRASE=1
// (best-effort obfuscation only - see docs/KEYS.md). `public`/`family` profiles
// embed nothing.

import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = 1;
const KEY_LEN = 32;
const KDF = { N: 1 << 16, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const DEFAULT_PASSPHRASE = "ds-embed-default-v1-not-a-real-secret";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "server", "embedded-secrets.json");
const rel = (p) => p.replace(root + "/", "");

// Provider id (server CredentialProvider name) -> env var holding the key.
const PROVIDER_ENV = {
  omdb: "OMDB_EMBED_KEY",
  tmdb: "TMDB_EMBED_KEY",
  real_debrid: "REALDEBRID_EMBED_KEY",
  all_debrid: "ALLDEBRID_EMBED_KEY",
  premiumize: "PREMIUMIZE_EMBED_KEY",
  torbox: "TORBOX_EMBED_KEY",
};

const profile = (process.env.DS_BUILD_PROFILE ?? "public").trim().toLowerCase();
if (!["family", "friends", "public"].includes(profile)) {
  console.error(`embed_secrets: invalid DS_BUILD_PROFILE "${profile}" (family|friends|public)`);
  process.exit(1);
}

const secrets = {};
for (const [provider, env] of Object.entries(PROVIDER_ENV)) {
  const value = process.env[env]?.trim();
  if (value) secrets[provider] = value;
}

// public + family embed nothing (family's server uses its own env keys).
if (profile !== "friends" || Object.keys(secrets).length === 0) {
  if (existsSync(outPath)) rmSync(outPath);
  console.log(
    `embed_secrets: profile=${profile}; nothing embedded` +
      (profile === "friends" ? " (no *_EMBED_KEY env provided)" : "") +
      `. Removed any existing ${rel(outPath)}.`,
  );
  process.exit(0);
}

const envPass = process.env.DS_EMBED_PASSPHRASE?.trim();
const allowDefault = process.env.DS_EMBED_ALLOW_DEFAULT_PASSPHRASE === "1";
if ((envPass == null || envPass.length === 0) && !allowDefault) {
  console.error(
    "embed_secrets: refusing to bake keys without DS_EMBED_PASSPHRASE.\n" +
      "  Set a strong DS_EMBED_PASSPHRASE (recommended - and supply it to the\n" +
      "  friend's server at runtime, not baked into the image), or explicitly\n" +
      "  opt into the weak baked-default passphrase with\n" +
      "  DS_EMBED_ALLOW_DEFAULT_PASSPHRASE=1 (best-effort only - see docs/KEYS.md).",
  );
  process.exit(1);
}
const passphrase = envPass && envPass.length > 0 ? envPass : DEFAULT_PASSPHRASE;
const usingDefault = passphrase === DEFAULT_PASSPHRASE;

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = scryptSync(passphrase, salt, KEY_LEN, { ...KDF, maxmem: SCRYPT_MAXMEM });
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([
  cipher.update(Buffer.from(JSON.stringify(secrets), "utf8")),
  cipher.final(),
]);
const blob = {
  v: VERSION,
  profile,
  kdf: KDF,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  data: ct.toString("base64"),
};

writeFileSync(outPath, JSON.stringify(blob, null, 2) + "\n", { mode: 0o600 });
console.log(
  `embed_secrets: profile=friends; embedded [${Object.keys(secrets).join(", ")}] (AES-256-GCM, scrypt N=${KDF.N}) -> ${rel(outPath)}`,
);
if (usingDefault) {
  console.warn(
    "embed_secrets: WARNING - baked DEFAULT passphrase. Best-effort obfuscation only; the shipped files alone decrypt this. Set DS_EMBED_PASSPHRASE for real protection. See docs/KEYS.md.",
  );
} else {
  console.log(
    "embed_secrets: the friend's server must be given the SAME DS_EMBED_PASSPHRASE at runtime to use these keys.",
  );
}
