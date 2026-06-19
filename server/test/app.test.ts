import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";

interface TestClient {
  app: FastifyInstance;
  cookies: Map<string, string>;
}

function rememberCookies(client: TestClient, response: LightMyRequestResponse): void {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of cookies) {
    const first = line.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq);
    const value = first.slice(eq + 1);
    if (value.length === 0) client.cookies.delete(name);
    else client.cookies.set(name, value);
  }
}

function cookieHeader(client: TestClient): string {
  return [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(
  client: TestClient,
  opts: {
    method: string;
    url: string;
    payload?: unknown;
    csrf?: boolean;
    headers?: Record<string, string>;
  },
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const cookie = cookieHeader(client);
  if (cookie.length > 0) headers.cookie = cookie;
  if (opts.csrf) {
    const token = client.cookies.get("ds_csrf");
    if (token) headers["x-csrf-token"] = token;
  }
  const response = await client.app.inject({
    method: opts.method,
    url: opts.url,
    payload: opts.payload,
    headers,
  });
  rememberCookies(client, response);
  return response;
}

function json<T = unknown>(response: LightMyRequestResponse): T {
  return JSON.parse(response.body) as T;
}

async function setupOwner(app: FastifyInstance): Promise<TestClient> {
  const client: TestClient = { app, cookies: new Map() };
  const response = await request(client, {
    method: "POST",
    url: "/api/auth/setup-owner",
    payload: {
      username: "owner",
      password: "owner-password",
      displayName: "Owner",
    },
  });
  expect(response.statusCode).toBe(200);
  expect(client.cookies.get("ds_session")).toBeTruthy();
  expect(client.cookies.get("ds_csrf")).toBeTruthy();
  return client;
}

async function createProfile(
  owner: TestClient,
  username: string,
  password: string,
): Promise<string> {
  const response = await request(owner, {
    method: "POST",
    url: "/api/profiles",
    csrf: true,
    payload: {
      username,
      password,
      displayName: username,
      role: "member",
    },
  });
  expect(response.statusCode).toBe(200);
  return json<{ profile: { id: string } }>(response).profile.id;
}

async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<TestClient> {
  const client: TestClient = { app, cookies: new Map() };
  const response = await request(client, {
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return client;
}

describe("DebridStreamer server", () => {
  let app: FastifyInstance;
  let upstream: Server | null = null;
  let upstreamUrl = "";

  beforeEach(async () => {
    app = await buildApp({
      config: {
        databasePath: ":memory:",
        dataDir: ".test-data",
        secretKey: randomBytes(32),
        cookieSecure: false,
        logger: false,
        allowRawStreamUrls: true,
      },
    });
  });

  afterEach(async () => {
    if (upstream != null) {
      await new Promise<void>((resolve) => upstream?.close(() => resolve()));
      upstream = null;
    }
    await app.close();
  });

  it("creates the first owner, starts a session, and rejects unsafe writes without CSRF", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(json<{ setupRequired: boolean }>(health).setupRequired).toBe(true);

    const owner = await setupOwner(app);
    const session = await request(owner, { method: "GET", url: "/api/auth/session" });
    expect(session.statusCode).toBe(200);
    expect(json<{ session: { username: string; role: string } }>(session).session).toMatchObject({
      username: "owner",
      role: "owner",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/setup-owner",
      payload: {
        username: "owner2",
        password: "owner-password",
        displayName: "Owner 2",
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const noCsrf = await request(owner, {
      method: "PUT",
      url: "/api/library/watchlist/tt001",
      payload: { preview: { id: "tt001", title: "No CSRF" } },
    });
    expect(noCsrf.statusCode).toBe(403);

    const setting = await request(owner, {
      method: "PUT",
      url: "/api/settings/profile",
      csrf: true,
      payload: { key: "ui_theme", value: "midnight" },
    });
    expect(setting.statusCode).toBe(200);

    const settings = await request(owner, {
      method: "GET",
      url: "/api/settings/profile",
    });
    expect(settings.statusCode).toBe(200);
    expect(json<{ settings: Record<string, string> }>(settings).settings).toMatchObject({
      ui_theme: "midnight",
    });
  });

  it("exposes profile simpleMode (as a boolean) and lets a profile flip it", async () => {
    const owner = await setupOwner(app);

    // Owner defaults to Advanced (simpleMode false). Assert it's a real boolean
    // so a regression that drops the int→boolean mapping (raw number leak) fails.
    const session1 = await request(owner, { method: "GET", url: "/api/auth/session" });
    const s1 = json<{ session: { profileId: string; simpleMode: boolean } }>(session1).session;
    expect(typeof s1.simpleMode).toBe("boolean");
    expect(s1.simpleMode).toBe(false);

    // Bootstrap carries it too.
    const boot = await request(owner, { method: "GET", url: "/api/bootstrap" });
    expect(json<{ session: { simpleMode: boolean } | null }>(boot).session?.simpleMode).toBe(false);

    // Self-edit: flip simpleMode on the owner's own profile.
    const patch = await request(owner, {
      method: "PATCH",
      url: `/api/profiles/${s1.profileId}`,
      csrf: true,
      payload: { simpleMode: true },
    });
    expect(patch.statusCode).toBe(200);

    // The next session reflects the flip.
    const session2 = await request(owner, { method: "GET", url: "/api/auth/session" });
    expect(json<{ session: { simpleMode: boolean } }>(session2).session.simpleMode).toBe(true);
  });

  it("rate-limits repeated login attempts for the same account and IP", async () => {
    await setupOwner(app);

    for (let i = 0; i < 10; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "owner",
          password: "wrong-password",
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "owner",
        password: "wrong-password",
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(json<{ error: string }>(limited).error).toMatch(/too many requests/i);
  });

  it("keeps watchlist and history isolated per profile", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "bob", "bob-password");
    const bob = await login(app, "bob", "bob-password");

    const ownerWatch = await request(owner, {
      method: "PUT",
      url: "/api/library/watchlist/tt-shared",
      csrf: true,
      payload: { preview: { id: "tt-shared", title: "Owner version" } },
    });
    expect(ownerWatch.statusCode).toBe(200);

    const bobWatch = await request(bob, {
      method: "PUT",
      url: "/api/library/watchlist/tt-shared",
      csrf: true,
      payload: { preview: { id: "tt-shared", title: "Bob version" } },
    });
    expect(bobWatch.statusCode).toBe(200);

    const ownerHistory = await request(owner, {
      method: "PUT",
      url: "/api/history/tt-shared",
      csrf: true,
      payload: {
        progressSeconds: 10,
        durationSeconds: 100,
        completed: false,
        preview: { id: "tt-shared", title: "Owner version" },
      },
    });
    expect(ownerHistory.statusCode).toBe(200);

    const bobHistory = await request(bob, {
      method: "PUT",
      url: "/api/history/tt-shared",
      csrf: true,
      payload: {
        progressSeconds: 90,
        durationSeconds: 100,
        completed: true,
        preview: { id: "tt-shared", title: "Bob version" },
      },
    });
    expect(bobHistory.statusCode).toBe(200);

    const ownerWatchlist = json<{ items: Array<{ preview: { title: string } }> }>(
      await request(owner, { method: "GET", url: "/api/library/watchlist" }),
    );
    const bobWatchlist = json<{ items: Array<{ preview: { title: string } }> }>(
      await request(bob, { method: "GET", url: "/api/library/watchlist" }),
    );
    expect(ownerWatchlist.items).toHaveLength(1);
    expect(bobWatchlist.items).toHaveLength(1);
    expect(ownerWatchlist.items[0]?.preview.title).toBe("Owner version");
    expect(bobWatchlist.items[0]?.preview.title).toBe("Bob version");

    const ownerHist = json<{ items: Array<{ progressSeconds: number; completed: boolean }> }>(
      await request(owner, { method: "GET", url: "/api/history" }),
    );
    const bobHist = json<{ items: Array<{ progressSeconds: number; completed: boolean }> }>(
      await request(bob, { method: "GET", url: "/api/history" }),
    );
    expect(ownerHist.items[0]).toMatchObject({ progressSeconds: 10, completed: false });
    expect(bobHist.items[0]).toMatchObject({ progressSeconds: 90, completed: true });
  });

  it("uses server credentials by default and profile credentials as overrides", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "bob", "bob-password");
    const bob = await login(app, "bob", "bob-password");

    const serverCred = await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: {
        provider: "real_debrid",
        label: "Shared RD",
        value: "server-token",
      },
    });
    expect(serverCred.statusCode).toBe(200);

    const bobInherited = json<{
      credentials: Array<{ provider: string; scope: string | null; label: string | null }>;
    }>(await request(bob, { method: "GET", url: "/api/credentials/effective" }));
    expect(bobInherited.credentials.find((c) => c.provider === "real_debrid")).toMatchObject({
      scope: "server",
      label: "Shared RD",
    });

    const profileCred = await request(bob, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: {
        provider: "real_debrid",
        label: "Bob RD",
        value: "bob-token",
      },
    });
    expect(profileCred.statusCode).toBe(200);

    const bobOverride = json<{
      credentials: Array<{ provider: string; scope: string | null; label: string | null }>;
    }>(await request(bob, { method: "GET", url: "/api/credentials/effective" }));
    expect(bobOverride.credentials.find((c) => c.provider === "real_debrid")).toMatchObject({
      scope: "profile",
      label: "Bob RD",
    });

    const ownerEffective = json<{
      credentials: Array<{ provider: string; scope: string | null; label: string | null }>;
    }>(await request(owner, { method: "GET", url: "/api/credentials/effective" }));
    expect(ownerEffective.credentials.find((c) => c.provider === "real_debrid")).toMatchObject({
      scope: "server",
      label: "Shared RD",
    });
  });

  it("searches streams server-side and resolves playback through a profile proxy session", async () => {
    const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    upstream = createServer((_req, res) => {
      const body = Buffer.from("server-stream");
      res.writeHead(200, {
        "content-length": String(body.length),
        "content-type": "video/mp4",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    if (address == null || typeof address === "string") throw new Error("Expected TCP test server.");
    upstreamUrl = `http://127.0.0.1:${address.port}/movie.mp4`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const urlString = String(url);
      if (urlString.startsWith(upstreamUrl)) {
        return originalFetch(url, init);
      }
      const parsed = new URL(urlString);
      if (parsed.hostname === "apibay.org") {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Example.Movie.2026.1080p.WEB-DL.x264",
              info_hash: hash,
              leechers: "1",
              seeders: "12",
              size: "1048576",
            },
          ]),
          { status: 200 },
        );
      }
      if (parsed.hostname === "yts.torrentbay.st") {
        return new Response(
          JSON.stringify({ status: "ok", data: { movies: [] } }),
          { status: 200 },
        );
      }
      if (parsed.hostname === "api.real-debrid.com") {
        if (parsed.pathname.endsWith("/torrents")) {
          return new Response("[]", { status: 200 });
        }
        if (parsed.pathname.endsWith("/torrents/addMagnet")) {
          return new Response(JSON.stringify({ id: "rd-torrent" }), { status: 201 });
        }
        if (parsed.pathname.endsWith("/torrents/info/rd-torrent")) {
          return new Response(
            JSON.stringify({
              status: "downloaded",
              links: ["https://real-debrid.example/restricted-link"],
              files: [
                {
                  id: 1,
                  path: "/Example.Movie.2026.1080p.WEB-DL.x264.mp4",
                  bytes: 1048576,
                  selected: 1,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (parsed.pathname.endsWith("/unrestrict/link")) {
          expect(String(init?.body)).toContain("real-debrid.example");
          return new Response(
            JSON.stringify({ download: upstreamUrl, id: "unrestricted-1" }),
            { status: 200 },
          );
        }
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const owner = await setupOwner(app);
      const credential = await request(owner, {
        method: "PUT",
        url: "/api/profile/credentials",
        csrf: true,
        payload: {
          provider: "real_debrid",
          label: "Owner RD",
          value: "rd-token",
        },
      });
      expect(credential.statusCode).toBe(200);

      const streams = await request(owner, {
        method: "GET",
        url: "/api/streams/tt1234567?type=movie",
      });
      expect(streams.statusCode).toBe(200);
      const streamBody = json<{
        rows: Array<{ result: { infoHash: string; title: string } }>;
        hasDebrid: boolean;
        hasIndexers: boolean;
      }>(streams);
      expect(streamBody.hasDebrid).toBe(true);
      expect(streamBody.hasIndexers).toBe(true);
      expect(streamBody.rows[0]?.result).toMatchObject({
        infoHash: hash,
        title: "Example.Movie.2026.1080p.WEB-DL.x264",
      });

      const resolved = await request(owner, {
        method: "POST",
        url: "/api/streams/resolve",
        csrf: true,
        payload: { infoHash: hash, preferredService: "real_debrid" },
      });
      expect(resolved.statusCode).toBe(200);
      const resolvedBody = json<{
        stream: { streamURL: string; debridService: string };
        session: { playbackUrl: string };
      }>(resolved);
      expect(resolvedBody.stream.debridService).toBe("RD");
      expect(resolvedBody.stream.streamURL).toBe(resolvedBody.session.playbackUrl);
      expect(resolvedBody.stream.streamURL).toMatch(/^\/api\/stream\/stream_/);

      const playback = await request(owner, {
        method: "GET",
        url: resolvedBody.stream.streamURL,
      });
      expect(playback.statusCode).toBe(200);
      expect(playback.headers["content-type"]).toBe("video/mp4");
      expect(playback.body).toBe("server-stream");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies stream sessions with Range support and rejects another profile", async () => {
    upstream = createServer((req, res) => {
      const body = Buffer.from("abcdefghij");
      if (req.headers.range === "bytes=0-3") {
        res.writeHead(206, {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-3/10",
          "content-length": "4",
          "content-type": "text/plain",
        });
        res.end(body.subarray(0, 4));
        return;
      }
      res.writeHead(200, {
        "accept-ranges": "bytes",
        "content-length": String(body.length),
        "content-type": "text/plain",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    if (address == null || typeof address === "string") throw new Error("Expected TCP test server.");
    upstreamUrl = `http://127.0.0.1:${address.port}/video`;

    const owner = await setupOwner(app);
    await createProfile(owner, "bob", "bob-password");
    const bob = await login(app, "bob", "bob-password");

    const created = await request(owner, {
      method: "POST",
      url: "/api/streams/sessions/raw",
      csrf: true,
      payload: {
        upstreamUrl,
        contentType: "text/plain",
      },
    });
    expect(created.statusCode).toBe(200);
    const playbackUrl = json<{ session: { playbackUrl: string } }>(created).session.playbackUrl;

    const ownerStream = await request(owner, {
      method: "GET",
      url: playbackUrl,
      headers: { range: "bytes=0-3" },
    });
    expect(ownerStream.statusCode).toBe(206);
    expect(ownerStream.headers["content-range"]).toBe("bytes 0-3/10");
    expect(ownerStream.body).toBe("abcd");

    const bobStream = await request(bob, {
      method: "GET",
      url: playbackUrl,
    });
    expect(bobStream.statusCode).toBe(404);
  });
});
