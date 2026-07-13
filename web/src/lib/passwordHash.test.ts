import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordHash, verifyPassword } from "./passwordHash";

describe("passwordHash", () => {
  it("produces a self-describing pbkdf2:v1 string and never leaks the plaintext", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("pbkdf2:v1:")).toBe(true);
    expect(stored.split(":")).toHaveLength(5);
    expect(stored).not.toContain("correct horse battery staple");
    expect(isPasswordHash(stored)).toBe(true);
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("s3cret-pass");
    await expect(verifyPassword("s3cret-pass", stored)).resolves.toBe(true);
    await expect(verifyPassword("s3cret-pas", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
    await expect(verifyPassword("S3cret-pass", stored)).resolves.toBe(false);
  });

  it("uses a random salt so equal passwords hash differently", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toEqual(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2:v1:0:aaaa:bbbb")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2:v2:210000:aaaa:bbbb")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt:v1:210000:aaaa:bbbb")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2:v1:210000::")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2:v1:notint:aaaa:bbbb")).resolves.toBe(false);
  });

  it("classifies hash strings without touching crypto", () => {
    expect(isPasswordHash(null)).toBe(false);
    expect(isPasswordHash(undefined)).toBe(false);
    expect(isPasswordHash("")).toBe(false);
    expect(isPasswordHash("plain")).toBe(false);
    expect(isPasswordHash("pbkdf2:v1:1:a:b")).toBe(true);
  });

  it("rejects an empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
