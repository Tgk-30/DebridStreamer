// SSRF guard for the streaming proxy.
//
// The proxy fetches a decrypted upstream URL on the server's behalf. Without a
// guard, an authenticated user (or, with DS_SERVER_ALLOW_RAW_STREAM_URLS, the
// dev default) — or a malicious/redirecting debrid response — could make the
// server fetch internal services or cloud metadata (http://169.254.169.254/...,
// loopback, RFC1918, etc.). We therefore (a) allow only http/https, (b) resolve
// the host and refuse any private/reserved address, and (c) follow redirects
// ourselves, re-validating each hop (so a public URL can't 302 to an internal
// one, and the single-IP property is preserved — the client never connects to
// the redirected host directly).
//
// Residual: this validates the DNS result then fetches by hostname, so a
// determined DNS-rebinding attacker could still race the two lookups. Pinning
// the resolved IP at connect time (a custom undici dispatcher) would close that;
// it's a worthwhile follow-up but out of scope for this guard.

import net from "node:net";
import { lookup } from "node:dns/promises";

const MAX_UPSTREAM_REDIRECTS = 3;

function upstreamError(message: string): Error & { statusCode: number } {
  const error = new Error(`Blocked upstream: ${message}.`) as Error & {
    statusCode: number;
  };
  error.statusCode = 502;
  return error;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function inCidr4(ip: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

function isPrivateOrReservedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return true; // unparseable → treat as unsafe
  return (
    inCidr4(n, "0.0.0.0", 8) || // "this" network
    inCidr4(n, "10.0.0.0", 8) || // RFC1918
    inCidr4(n, "100.64.0.0", 10) || // CGNAT
    inCidr4(n, "127.0.0.0", 8) || // loopback
    inCidr4(n, "169.254.0.0", 16) || // link-local / cloud metadata
    inCidr4(n, "172.16.0.0", 12) || // RFC1918
    inCidr4(n, "192.0.0.0", 24) || // IETF protocol assignments
    inCidr4(n, "192.168.0.0", 16) || // RFC1918
    inCidr4(n, "198.18.0.0", 15) || // benchmarking
    inCidr4(n, "224.0.0.0", 4) || // multicast
    inCidr4(n, "240.0.0.0", 4) // reserved + 255.255.255.255
  );
}

function isPrivateOrReservedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedV4(mapped[1] as string);
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // link-local fe80::/10 → first hextet fe80..febf
  if (/^fe[89ab]/.test(lower)) return true;
  // unique-local fc00::/7 → fc.. or fd..
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

/** True for loopback, private (RFC1918/ULA), link-local, CGNAT, multicast, and
 *  other reserved ranges. Non-IP input is treated as unsafe. */
export function isPrivateOrReserved(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateOrReservedV4(ip);
  if (kind === 6) return isPrivateOrReservedV6(ip);
  return true;
}

/**
 * Throws a 502 unless `raw` is an http(s) URL pointing at an allowed host. The
 * scheme check (http/https only) is always enforced. The private/reserved-address
 * block is enforced unless `allowPrivate` is true — which the caller sets when the
 * operator has explicitly opted into arbitrary/raw URLs (DS_SERVER_ALLOW_RAW_STREAM_URLS,
 * the dev default), so localhost/LAN upstreams work for local testing and on-LAN
 * sources. In production that flag is off, so the full SSRF guard applies.
 */
export async function assertSafeUpstream(raw: string, allowPrivate: boolean): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw upstreamError("malformed URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw upstreamError(`unsupported scheme ${url.protocol}`);
  }
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      throw upstreamError("DNS resolution failed");
    }
  }
  if (addresses.length === 0) throw upstreamError("host did not resolve");
  for (const address of addresses) {
    if (isPrivateOrReserved(address)) {
      throw upstreamError("host resolves to a private or reserved address");
    }
  }
}

/** Fetch `initialUrl`, validating it and every redirect hop against
 *  {@link assertSafeUpstream}. Redirects are followed server-side (manual) so the
 *  single-IP property holds and a public URL can't bounce to an internal one. */
export async function fetchUpstreamSafely(
  initialUrl: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  allowPrivate = false,
): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_UPSTREAM_REDIRECTS; hop += 1) {
    await assertSafeUpstream(current, allowPrivate);
    const response = await fetch(current, { ...init, redirect: "manual" });
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (isRedirect && location != null) {
      const next = new URL(location, current).toString();
      try {
        await response.body?.cancel();
      } catch {
        // ignore — we're discarding this hop's body
      }
      current = next;
      continue;
    }
    return response;
  }
  throw upstreamError("too many redirects");
}
