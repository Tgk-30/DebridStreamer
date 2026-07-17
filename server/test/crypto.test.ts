// Password hashing. The work factor became tunable so the suite stops paying the
// full scrypt cost on every owner/profile setup (that cost pushed the longest
// test past vitest's 20s limit on a loaded CI runner and failed a release
// build). These tests pin the security properties that made that safe.

import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/crypto";

const SHIPPED_N = 2 ** 15;

function costOf(hash: string): number {
  return Number(hash.split(":")[2]);
}

const originalNodeEnv = process.env.NODE_ENV;
const originalOverride = process.env.DS_SCRYPT_N;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalOverride === undefined) delete process.env.DS_SCRYPT_N;
  else process.env.DS_SCRYPT_N = originalOverride;
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "Correct horse battery staple")).resolves.toBe(false);
    await expect(verifyPassword(hash, "")).resolves.toBe(false);
  });

  it("salts each hash, so the same password never yields the same digest", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, "same")).resolves.toBe(true);
    await expect(verifyPassword(b, "same")).resolves.toBe(true);
  });

  it("IGNORES the cost override outside NODE_ENV=test", async () => {
    // The security property that makes the knob safe: an env var must never be
    // able to weaken password hashing in a real deployment.
    process.env.NODE_ENV = "production";
    process.env.DS_SCRYPT_N = "2";
    const hash = await hashPassword("pw");
    expect(costOf(hash)).toBe(SHIPPED_N);
  });

  it("ignores a non-power-of-two or nonsense override under test", async () => {
    process.env.NODE_ENV = "test";
    for (const bad of ["1000", "0", "1", "-4096", "abc", ""]) {
      process.env.DS_SCRYPT_N = bad;
      expect(costOf(await hashPassword("pw"))).toBe(SHIPPED_N);
    }
  });

  it("honours a valid override under test, and the hash stays verifiable", async () => {
    process.env.NODE_ENV = "test";
    process.env.DS_SCRYPT_N = "1024";
    const hash = await hashPassword("pw");
    expect(costOf(hash)).toBe(1024);
    await expect(verifyPassword(hash, "pw")).resolves.toBe(true);
  });

  it("verifies a hash written at ANY cost, because the cost travels with it", async () => {
    // Why lowering the cost in tests cannot strand a stored password: verify
    // reads N/r/p back out of the hash rather than assuming today's default. The
    // same rule is what would let the shipped factor be raised later without
    // invalidating everyone's existing password.
    process.env.NODE_ENV = "test";
    process.env.DS_SCRYPT_N = "1024";
    const cheap = await hashPassword("pw");
    process.env.DS_SCRYPT_N = "4096";
    const dearer = await hashPassword("pw");

    expect(costOf(cheap)).toBe(1024);
    expect(costOf(dearer)).toBe(4096);
    // Each verifies regardless of what the CURRENT default happens to be.
    await expect(verifyPassword(cheap, "pw")).resolves.toBe(true);
    await expect(verifyPassword(dearer, "pw")).resolves.toBe(true);
  });

  it("rejects a malformed or foreign hash instead of throwing", async () => {
    for (const bad of ["", "nonsense", "bcrypt:v1:1:1:1:salt:digest", "scrypt:v2:1024:8:1:s:d", "scrypt:v1:notanumber:8:1:s:d"]) {
      await expect(verifyPassword(bad, "pw")).resolves.toBe(false);
    }
  });
});
