// Local-profile password hashing for optional per-profile protection.
//
// This is an honest household/parental access gate, NOT encryption: the local
// Dexie database is unencrypted at rest, so a profile password prevents casual
// access to another person's profile on the same machine, not disk-level
// access. We store only a derived hash, never the plaintext.
//
// PBKDF2-SHA256 via Web Crypto (crypto.subtle) is used because it is the only
// vetted KDF available in both the browser and the Tauri webview (a secure
// context); scrypt/argon2/bcrypt are not in the web dependency set. The stored
// value is a self-describing string mirroring the server's "scrypt:v1:..."
// convention in server/src/crypto.ts:
//
//   pbkdf2:v1:<iterations>:<salt_b64url>:<hash_b64url>

const SCHEME = "pbkdf2";
const VERSION = "v1";
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  // ArrayBuffer-backed (never SharedArrayBuffer) so it satisfies BufferSource
  // for crypto.subtle under TS 5.7+ lib.dom typings.
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Length-independent constant-time comparison of two byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Derive a self-describing password hash string. Never stores plaintext. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) throw new Error("password must not be empty");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return [SCHEME, VERSION, String(ITERATIONS), toBase64Url(salt), toBase64Url(hash)].join(":");
}

/**
 * Verify a candidate password against a stored hash string. Returns false for a
 * malformed/unknown-scheme stored value rather than throwing, so a corrupt
 * record locks the profile rather than crashing the app.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 5) return false;
  const [scheme, version, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== SCHEME || version !== VERSION) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64Url(saltRaw);
    expected = fromBase64Url(hashRaw);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** True when a stored string is a well-formed hash this module can verify. */
export function isPasswordHash(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  return parts.length === 5 && parts[0] === SCHEME && parts[1] === VERSION;
}
