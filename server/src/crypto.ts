import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export function nowISO(): string {
  return new Date().toISOString();
}

export function addSecondsISO(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashOptional(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return sha256(value);
}

export function normalizeSecretKey(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length < 32) throw new Error("Secret key must be at least 32 bytes.");
    return input.subarray(0, 32);
  }

  const trimmed = input.trim();
  if (/^[a-f0-9]{64,}$/i.test(trimmed)) {
    return Buffer.from(trimmed.slice(0, 64), "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length >= 32) return decoded.subarray(0, 32);
  } catch {
    // Fall through to hash-based normalization.
  }

  return createHash("sha256").update(trimmed).digest();
}

export function encryptSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted secret payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const params = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derived = await scryptAsync(password, salt, 64, params);
  return [
    "scrypt",
    "v1",
    String(params.N),
    String(params.r),
    String(params.p),
    salt,
    derived.toString("base64url"),
  ].join(":");
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [algorithm, version, nRaw, rRaw, pRaw, salt, expectedRaw] = hash.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expectedRaw) {
    return false;
  }
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  const expected = Buffer.from(expectedRaw, "base64url");
  const actual = await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
