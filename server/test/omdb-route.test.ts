import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";

const SECRET = "omdb-secret-key-DO-NOT-LEAK-xyz";

function parseCookies(res: LightMyRequestResponse): Map<string, string> {
  const raw = res.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = new Map<string, string>();
  for (const line of lines) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v) out.set(k, v);
  }
  return out;
}

const cookieHeader = (c: Map<string, string>) =>
  [...c.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function ownerApp(omdbApiKey: string | null) {
  const app = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: ".test-data-omdb",
      secretKey: randomBytes(32),
      cookieSecure: false,
      logger: false,
      omdbApiKey,
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/setup-owner",
    payload: { username: "owner", password: "owner-password", displayName: "Owner" },
  });
  expect(res.statusCode).toBe(200);
  return { app, cookies: parseCookies(res) };
}

describe("OMDb hidden-key proxy", () => {
  it("requires authentication", async () => {
    const { app } = await ownerApp(SECRET);
    const res = await app.inject({ method: "GET", url: "/api/omdb/tt0816692" });
    expect(res.statusCode).toBeGreaterThanOrEqual(401);
    expect(res.statusCode).toBeLessThan(404);
    await app.close();
  });

  it("advertises omdbProxy=true when a server key is configured, and NEVER leaks the key", async () => {
    const { app, cookies } = await ownerApp(SECRET);
    const headers = { cookie: cookieHeader(cookies) };

    const boot = await app.inject({ method: "GET", url: "/api/bootstrap", headers });
    expect(boot.statusCode).toBe(200);
    expect(JSON.parse(boot.body).omdbProxy).toBe(true);

    const creds = await app.inject({ method: "GET", url: "/api/credentials/effective", headers });

    // The plaintext key must not appear in ANY client-facing response body.
    expect(boot.body).not.toContain(SECRET);
    expect(creds.body).not.toContain(SECRET);
    await app.close();
  });

  it("advertises omdbProxy=false and returns ratings:null with no key, without a network call", async () => {
    const { app, cookies } = await ownerApp(null);
    const headers = { cookie: cookieHeader(cookies) };

    const boot = await app.inject({ method: "GET", url: "/api/bootstrap", headers });
    expect(JSON.parse(boot.body).omdbProxy).toBe(false);

    const res = await app.inject({ method: "GET", url: "/api/omdb/tt0816692", headers });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ratings: null });
    await app.close();
  });

  it("rejects a malformed imdb id", async () => {
    const { app, cookies } = await ownerApp(SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/api/omdb/not-a-valid-id",
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    await app.close();
  });
});

describe("OMDb key broker endpoint", () => {
  async function brokerApp(brokerTokens: string[], omdbApiKey: string | null) {
    return buildApp({
      config: {
        databasePath: ":memory:",
        dataDir: ".test-data-omdb",
        secretKey: randomBytes(32),
        cookieSecure: false,
        logger: false,
        brokerTokens,
        omdbApiKey,
      },
    });
  }

  it("rejects a missing or wrong broker token with 401 (no session needed)", async () => {
    const app = await brokerApp(["good-token"], SECRET);
    const noTok = await app.inject({ method: "GET", url: "/api/broker/omdb/tt1375666" });
    expect(noTok.statusCode).toBe(401);
    const badTok = await app.inject({
      method: "GET",
      url: "/api/broker/omdb/tt1375666",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(badTok.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a valid token but 503s when the broker itself has no key (no network)", async () => {
    const app = await brokerApp(["good-token"], null);
    const res = await app.inject({
      method: "GET",
      url: "/api/broker/omdb/tt1375666",
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("never accepts any token when no broker tokens are configured", async () => {
    const app = await brokerApp([], SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/api/broker/omdb/tt1375666",
      headers: { authorization: "Bearer anything" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
