import { describe, expect, it } from "vitest";
import { assertSafeUpstream, isPrivateOrReserved } from "../src/ssrf.js";

describe("isPrivateOrReserved", () => {
  it("flags loopback, RFC1918, link-local/metadata, CGNAT, and reserved v4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.5.5",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPrivateOrReserved(ip), ip).toBe(true);
    }
  });

  it("flags loopback/link-local/ULA and IPv4-mapped v6", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateOrReserved(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateOrReserved(ip), ip).toBe(false);
    }
  });

  it("treats non-IP input as unsafe", () => {
    expect(isPrivateOrReserved("not-an-ip")).toBe(true);
  });
});

describe("assertSafeUpstream", () => {
  // Use literal IPs so no DNS lookup is needed.
  it("rejects non-http(s) schemes regardless of allowPrivate", async () => {
    await expect(assertSafeUpstream("file:///etc/passwd", true)).rejects.toThrow(/scheme/i);
    await expect(assertSafeUpstream("ftp://8.8.8.8/x", false)).rejects.toThrow(/scheme/i);
  });

  it("rejects private/reserved hosts when allowPrivate is false", async () => {
    await expect(assertSafeUpstream("http://169.254.169.254/latest/meta-data/", false)).rejects.toThrow(
      /private or reserved/i,
    );
    await expect(assertSafeUpstream("http://127.0.0.1:8080/internal", false)).rejects.toThrow(
      /private or reserved/i,
    );
    await expect(assertSafeUpstream("http://[::1]/x", false)).rejects.toThrow(/private or reserved/i);
  });

  it("allows private hosts when allowPrivate is true (operator opted in)", async () => {
    await expect(assertSafeUpstream("http://127.0.0.1:8080/internal", true)).resolves.toBeUndefined();
  });

  it("allows public hosts when allowPrivate is false", async () => {
    await expect(assertSafeUpstream("https://8.8.8.8/stream.mkv", false)).resolves.toBeUndefined();
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeUpstream("http://", false)).rejects.toThrow();
  });
});
