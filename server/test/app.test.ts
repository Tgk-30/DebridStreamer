import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
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
  role: "admin" | "member" | "restricted" = "member",
): Promise<string> {
  const response = await request(owner, {
    method: "POST",
    url: "/api/profiles",
    csrf: true,
    payload: {
      username,
      password,
      displayName: username,
      role,
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

  it("seeds system folders and supports folder + entry CRUD with DexieStore parity", async () => {
    const owner = await setupOwner(app);

    // System folders are seeded lazily on first read: 3 roots + Watched + Release Wait.
    const folders0 = json<{
      folders: Array<{ id: string; folderKind: string; isSystem: boolean; name: string }>;
    }>(await request(owner, { method: "GET", url: "/api/library/folders" })).folders;
    expect(folders0.map((f) => f.folderKind).sort()).toEqual([
      "release_wait",
      "system_root",
      "system_root",
      "system_root",
      "watched",
    ]);
    expect(folders0.every((f) => f.isSystem)).toBe(true);
    const favRootId = folders0.find((f) => f.folderKind === "system_root" && f.name === "Library")!.id;

    // No CSRF → 403 on a write.
    expect(
      (await request(owner, { method: "PUT", url: "/api/library/m1", payload: { listType: "favorites", preview: { id: "m1" } } })).statusCode,
    ).toBe(403);

    // Create folder under favorites (manual, non-system).
    const created = json<{ folder: { id: string; name: string; folderKind: string; isSystem: boolean } }>(
      await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Action", listType: "favorites" } }),
    ).folder;
    expect(created).toMatchObject({ name: "Action", folderKind: "manual", isSystem: false });
    const actionId = created.id;

    // Duplicate name disambiguates to "Action (2)".
    expect(
      json<{ folder: { name: string } }>(
        await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Action", listType: "favorites" } }),
      ).folder.name,
    ).toBe("Action (2)");

    // Folders unsupported for watchlist.
    expect(
      (await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "x", listType: "watchlist" } })).statusCode,
    ).toBe(400);

    // Add to the manual folder; add another with no folderId → defaults to favorites root.
    const e1 = json<{ entry: { id: string; folderId: string } }>(
      await request(owner, { method: "PUT", url: "/api/library/m1", csrf: true, payload: { listType: "favorites", folderId: actionId, preview: { id: "m1", title: "M1" } } }),
    ).entry;
    expect(e1.folderId).toBe(actionId);
    const e3 = json<{ entry: { folderId: string } }>(
      await request(owner, { method: "PUT", url: "/api/library/m3", csrf: true, payload: { listType: "favorites", preview: { id: "m3" } } }),
    ).entry;
    expect(e3.folderId).toBe(favRootId);

    // Dedup + COALESCE: re-add m1 to the same folder updates in place; addedAt preserved.
    const e1b = json<{ entry: { id: string; customListName: string | null } }>(
      await request(owner, { method: "PUT", url: "/api/library/m1", csrf: true, payload: { listType: "favorites", folderId: actionId, customListName: "Fav", preview: { id: "m1", title: "M1b" } } }),
    ).entry;
    expect(e1b.id).toBe(e1.id);
    expect(e1b.customListName).toBe("Fav");

    // An explicit addedAt on re-add wins (DexieStore parity); omitting it keeps
    // the existing value (already covered by the m1 dedup above).
    expect(
      json<{ entry: { addedAt: string } }>(
        await request(owner, { method: "PUT", url: "/api/library/m3", csrf: true, payload: { listType: "favorites", addedAt: "2030-01-01T00:00:00.000Z", preview: { id: "m3" } } }),
      ).entry.addedAt,
    ).toBe("2030-01-01T00:00:00.000Z");
    expect(
      json<{ items: Array<{ mediaId: string }> }>(
        await request(owner, { method: "GET", url: "/api/library?listType=favorites" }),
      ).items.map((e) => e.mediaId).sort(),
    ).toEqual(["m1", "m3"]);

    // Remove an entry.
    await request(owner, { method: "DELETE", url: `/api/library/entry/${e1.id}`, csrf: true });
    expect(
      json<{ items: Array<{ mediaId: string }> }>(
        await request(owner, { method: "GET", url: "/api/library?listType=favorites" }),
      ).items.map((e) => e.mediaId),
    ).toEqual(["m3"]);

    // Delete system folder → 400; delete manual → 200; delete missing → 200 (no-op).
    expect((await request(owner, { method: "DELETE", url: `/api/library/folders/${favRootId}`, csrf: true })).statusCode).toBe(400);
    expect((await request(owner, { method: "DELETE", url: `/api/library/folders/${actionId}`, csrf: true })).statusCode).toBe(200);
    expect((await request(owner, { method: "DELETE", url: "/api/library/folders/nope", csrf: true })).statusCode).toBe(200);
  });

  it("re-parents entries to the system root on folder delete, deduping collisions", async () => {
    const owner = await setupOwner(app);
    const favRootId = json<{ folders: Array<{ id: string; folderKind: string }> }>(
      await request(owner, { method: "GET", url: "/api/library/folders?listType=favorites" }),
    ).folders.find((f) => f.folderKind === "system_root")!.id;
    const actionId = json<{ folder: { id: string } }>(
      await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Action", listType: "favorites" } }),
    ).folder.id;

    // m1 lives in both Action and the root (collision); m9 only in Action.
    await request(owner, { method: "PUT", url: "/api/library/m1", csrf: true, payload: { listType: "favorites", folderId: actionId, preview: { id: "m1" } } });
    await request(owner, { method: "PUT", url: "/api/library/m1", csrf: true, payload: { listType: "favorites", folderId: favRootId, preview: { id: "m1" } } });
    await request(owner, { method: "PUT", url: "/api/library/m9", csrf: true, payload: { listType: "favorites", folderId: actionId, preview: { id: "m9" } } });

    await request(owner, { method: "DELETE", url: `/api/library/folders/${actionId}`, csrf: true });

    const items = json<{ items: Array<{ mediaId: string; folderId: string }> }>(
      await request(owner, { method: "GET", url: "/api/library?listType=favorites" }),
    ).items;
    expect(items.filter((e) => e.mediaId === "m1")).toHaveLength(1); // collision deduped
    expect(items.find((e) => e.mediaId === "m9")?.folderId).toBe(favRootId); // re-parented
  });

  it("isolates library + folders per profile (no IDOR)", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "carol", "carol-password");
    const carol = await login(app, "carol", "carol-password");

    const fA = json<{ folder: { id: string } }>(
      await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Owner Folder", listType: "favorites" } }),
    ).folder;
    const eA = json<{ entry: { id: string } }>(
      await request(owner, { method: "PUT", url: "/api/library/o1", csrf: true, payload: { listType: "favorites", folderId: fA.id, preview: { id: "o1" } } }),
    ).entry;

    // Carol sees none of owner's rows.
    expect(json<{ items: unknown[] }>(await request(carol, { method: "GET", url: "/api/library?listType=favorites" })).items).toHaveLength(0);
    expect(
      json<{ folders: Array<{ name: string }> }>(await request(carol, { method: "GET", url: "/api/library/folders?listType=favorites" })).folders.some((f) => f.name === "Owner Folder"),
    ).toBe(false);
    expect(json<{ items: unknown[] }>(await request(carol, { method: "GET", url: `/api/library/folder/${fA.id}` })).items).toHaveLength(0);

    // Carol's deletes can't touch owner's rows.
    await request(carol, { method: "DELETE", url: `/api/library/entry/${eA.id}`, csrf: true });
    await request(carol, { method: "DELETE", url: `/api/library/folders/${fA.id}`, csrf: true });
    expect(json<{ items: unknown[] }>(await request(owner, { method: "GET", url: "/api/library?listType=favorites" })).items).toHaveLength(1);
    expect(
      json<{ folders: Array<{ name: string }> }>(await request(owner, { method: "GET", url: "/api/library/folders?listType=favorites" })).folders.some((f) => f.name === "Owner Folder"),
    ).toBe(true);
  });

  it("saveFolder validates parentId: unknown or cross-profile → 400 (no 500, no IDOR re-parent)", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "dave", "dave-password");
    const dave = await login(app, "dave", "dave-password");

    const ownerFolderId = json<{ folder: { id: string } }>(
      await request(owner, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Owner", listType: "favorites" } }),
    ).folder.id;
    const daveFolderId = json<{ folder: { id: string } }>(
      await request(dave, { method: "POST", url: "/api/library/folders", csrf: true, payload: { name: "Dave", listType: "favorites" } }),
    ).folder.id;

    const saveBody = (parentId: string | null) => ({
      name: "Renamed",
      parentId,
      listType: "favorites",
      folderKind: "manual",
      isSystem: false,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    // Unknown parent → clean 400 (not a raw FK 500).
    expect(
      (await request(dave, { method: "PUT", url: `/api/library/folders/${daveFolderId}`, csrf: true, payload: saveBody("does-not-exist") })).statusCode,
    ).toBe(400);
    // Another profile's folder as parent → 400 (no cross-profile re-parent).
    expect(
      (await request(dave, { method: "PUT", url: `/api/library/folders/${daveFolderId}`, csrf: true, payload: saveBody(ownerFolderId) })).statusCode,
    ).toBe(400);
    // Valid same-profile rename (no parent) → 200.
    expect(
      (await request(dave, { method: "PUT", url: `/api/library/folders/${daveFolderId}`, csrf: true, payload: saveBody(null) })).statusCode,
    ).toBe(200);
  });

  it("server AI recommend: requires a key, enforces auth + CSRF, and parses provider output", async () => {
    const owner = await setupOwner(app);

    // No AI credential configured → 400 with the configure message.
    const noKey = await request(owner, {
      method: "POST",
      url: "/api/ai/recommend",
      csrf: true,
      payload: { prompt: "cozy mysteries" },
    });
    expect(noKey.statusCode).toBe(400);
    expect(json<{ error: string }>(noKey).error).toMatch(/configure an ai provider/i);

    // Missing CSRF → 403; unauthenticated → 401.
    expect(
      (await request(owner, { method: "POST", url: "/api/ai/recommend", payload: { prompt: "x" } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/ai/recommend", payload: { prompt: "x" } })).statusCode,
    ).toBe(401);

    // Store a server-wide Anthropic key and stub the upstream. The stub echoes the
    // x-api-key it received back as the recommendation title, so the assertion also
    // proves which credential the server selected.
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk-server", label: "AI" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const text = JSON.stringify({
          recommendations: [{ title: `key:${headers["x-api-key"]}`, year: 2014, reason: "r", score: 0.9 }],
        });
        return new Response(
          JSON.stringify({ content: [{ type: "text", text }], model: "claude-haiku-4-5", usage: { input_tokens: 5, output_tokens: 7 } }),
          { status: 200 },
        );
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const ok = await request(owner, {
        method: "POST",
        url: "/api/ai/recommend",
        csrf: true,
        payload: { prompt: "mind-bending sci-fi" },
      });
      expect(ok.statusCode).toBe(200);
      const recs = json<{ recommendations: Array<{ title: string; year: number }> }>(ok).recommendations;
      expect(recs).toHaveLength(1);
      expect(recs[0].title).toBe("key:sk-server");
      expect(recs[0].year).toBe(2014);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI: a profile-scoped key overrides the server key for that profile only", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "carol", "carol-password");
    const carol = await login(app, "carol", "carol-password");

    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk-server", label: "AI" },
    });
    await request(carol, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk-carol", label: "AI" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const text = JSON.stringify({
          recommendations: [{ title: headers["x-api-key"], year: 2000, reason: "r", score: 0.5 }],
        });
        return new Response(JSON.stringify({ content: [{ type: "text", text }], model: "m" }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const ownerTitle = json<{ recommendations: Array<{ title: string }> }>(
        await request(owner, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x" } }),
      ).recommendations[0].title;
      const carolTitle = json<{ recommendations: Array<{ title: string }> }>(
        await request(carol, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x" } }),
      ).recommendations[0].title;
      expect(ownerTitle).toBe("sk-server"); // owner falls back to the shared server key
      expect(carolTitle).toBe("sk-carol"); // carol's profile override wins for carol
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI: maps an upstream provider failure to 502", async () => {
    const owner = await setupOwner(app);
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk", label: "AI" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com")) return new Response("upstream boom", { status: 500 });
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x" } });
      expect(res.statusCode).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI curate: resolves AI titles via TMDB and counts unmatched", async () => {
    const owner = await setupOwner(app);
    for (const cred of [
      { provider: "anthropic", value: "sk", label: "AI" },
      { provider: "tmdb", value: "tmdb-key", label: "TMDB" },
    ]) {
      await request(owner, { method: "PUT", url: "/api/admin/credentials", csrf: true, payload: cred });
    }

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.startsWith("https://api.anthropic.com")) {
        const text = JSON.stringify({
          recommendations: [
            { title: "Inception", year: 2010, reason: "r", score: 0.9 },
            { title: "Nonexistent Film 9000", year: 1900, reason: "r", score: 0.4 },
          ],
        });
        return new Response(JSON.stringify({ content: [{ type: "text", text }], model: "m" }), { status: 200 });
      }
      if (u.startsWith("https://api.themoviedb.org")) {
        const query = new URL(u).searchParams.get("query") ?? "";
        const results = query.startsWith("Inception")
          ? [{ id: 27205, media_type: "movie", title: "Inception", release_date: "2010-07-16", poster_path: "/p.jpg", vote_average: 8.3 }]
          : [];
        return new Response(JSON.stringify({ page: 1, total_pages: 1, total_results: results.length, results }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, { method: "POST", url: "/api/ai/curate", csrf: true, payload: { prompt: "heist" } });
      expect(res.statusCode).toBe(200);
      const out = json<{ items: Array<{ id: string; title: string }>; unmatched: number }>(res);
      expect(out.items).toHaveLength(1);
      expect(out.items[0].title).toBe("Inception");
      expect(out.items[0].id).toBe("tmdb-27205");
      expect(out.unmatched).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI recommend: enforces the count bounds (1..20)", async () => {
    const owner = await setupOwner(app);
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk", label: "AI" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com")) {
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ recommendations: [] }) }], model: "m" }),
          { status: 200 },
        );
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const recommend = (count: number) =>
        request(owner, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x", count } });
      expect((await recommend(0)).statusCode).toBe(400); // below min
      expect((await recommend(21)).statusCode).toBe(400); // above max
      expect((await recommend(1)).statusCode).toBe(200); // min ok
      expect((await recommend(20)).statusCode).toBe(200); // max ok
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI: falls back to a guarded Ollama endpoint when no cloud key is set", async () => {
    const owner = await setupOwner(app);
    // Only an Ollama endpoint configured → selectProvider must pick ollama. The
    // app is built with allowRawStreamUrls:true (see beforeEach), so the SSRF
    // guard permits the loopback endpoint.
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "ollama", value: "http://127.0.0.1:11434/api/chat", label: "Ollama" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:11434")) {
        // Ollama's chat shape: the provider reads message.content.
        const text = JSON.stringify({ recommendations: [{ title: "Local Pick", year: 2024, reason: "r", score: 0.7 }] });
        return new Response(JSON.stringify({ message: { role: "assistant", content: text } }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x" } });
      expect(res.statusCode).toBe(200);
      const recs = json<{ recommendations: Array<{ title: string }> }>(res).recommendations;
      expect(recs).toHaveLength(1);
      expect(recs[0].title).toBe("Local Pick");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server AI: the Ollama SSRF guard blocks an internal endpoint when raw URLs are off", async () => {
    // A locked-down deployment (allowRawStreamUrls:false) must not let an Ollama
    // endpoint pointing at the cloud-metadata address reach the internal network.
    const hardened = await buildApp({
      config: {
        databasePath: ":memory:",
        dataDir: ".test-data",
        secretKey: randomBytes(32),
        cookieSecure: false,
        logger: false,
        allowRawStreamUrls: false,
      },
    });
    try {
      const owner = await setupOwner(hardened);
      await request(owner, {
        method: "PUT",
        url: "/api/admin/credentials",
        csrf: true,
        payload: { provider: "ollama", value: "http://169.254.169.254/api/chat", label: "Ollama" },
      });
      // The guard throws before any fetch; mapped to a generic 502 (no detail leak).
      const res = await request(owner, { method: "POST", url: "/api/ai/recommend", csrf: true, payload: { prompt: "x" } });
      expect(res.statusCode).toBe(502);
    } finally {
      await hardened.close();
    }
  });

  it("server subtitles search: requires a key, enforces auth + CSRF, and parses results", async () => {
    const owner = await setupOwner(app);

    const noKey = await request(owner, {
      method: "POST",
      url: "/api/subtitles/search",
      csrf: true,
      payload: { imdbId: "tt1375666" },
    });
    expect(noKey.statusCode).toBe(400);
    expect(json<{ error: string }>(noKey).error).toMatch(/configure an opensubtitles/i);

    expect(
      (await request(owner, { method: "POST", url: "/api/subtitles/search", payload: { imdbId: "tt1" } })).statusCode,
    ).toBe(403); // no CSRF
    expect(
      (await app.inject({ method: "POST", url: "/api/subtitles/search", payload: { imdbId: "tt1" } })).statusCode,
    ).toBe(401); // unauthenticated

    // A search with neither imdbId nor query → 400 (zod refine).
    expect(
      (await request(owner, { method: "POST", url: "/api/subtitles/search", csrf: true, payload: { languages: ["en"] } })).statusCode,
    ).toBe(400);

    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "opensubtitles", value: "os-key", label: "OS" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.opensubtitles.com/api/v1/subtitles")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        // Echo the Api-Key back as the release name to prove credential selection.
        const body = {
          data: [
            { attributes: { language: "en", release: headers["Api-Key"], download_count: 42, files: [{ file_id: 111 }] } },
          ],
        };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, {
        method: "POST",
        url: "/api/subtitles/search",
        csrf: true,
        payload: { imdbId: "tt1375666", languages: ["en"] },
      });
      expect(res.statusCode).toBe(200);
      const results = json<{ results: Array<{ fileId: string; language: string; release: string }> }>(res).results;
      expect(results).toHaveLength(1);
      expect(results[0].fileId).toBe("111");
      expect(results[0].language).toBe("en");
      expect(results[0].release).toBe("os-key"); // used the stored server key
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server subtitles fetch: downloads, decompresses gzip, and returns decoded VTT", async () => {
    const owner = await setupOwner(app);
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "opensubtitles", value: "os-key", label: "OS" },
    });

    // A real local server serving a GZIPPED SRT — proves undici auto-decompresses
    // before .text(), then subsrt-ts parses and cuesToVTT runs under Node.
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello world\n";
    upstream = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/x-subrip", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from(srt)));
    });
    await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    if (address == null || typeof address === "string") throw new Error("Expected TCP test server.");
    upstreamUrl = `http://127.0.0.1:${address.port}/sub.srt.gz`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.startsWith(upstreamUrl)) return originalFetch(url, init); // real gzip server
      if (u.startsWith("https://api.opensubtitles.com/api/v1/download")) {
        return new Response(JSON.stringify({ link: upstreamUrl }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, {
        method: "POST",
        url: "/api/subtitles/fetch",
        csrf: true,
        payload: { fileId: "111" },
      });
      expect(res.statusCode).toBe(200);
      const vtt = json<{ vtt: string }>(res).vtt;
      expect(vtt.startsWith("WEBVTT")).toBe(true);
      expect(vtt).toContain("Hello world");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server subtitles fetch: returns 422 for an empty/unreadable subtitle", async () => {
    const owner = await setupOwner(app);
    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "opensubtitles", value: "os-key", label: "OS" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.startsWith("https://api.opensubtitles.com/api/v1/download")) {
        return new Response(JSON.stringify({ link: "https://dl.opensubtitles.example/garbage" }), { status: 200 });
      }
      if (u.startsWith("https://dl.opensubtitles.example/")) {
        return new Response("not a subtitle file — no timestamps here", { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, { method: "POST", url: "/api/subtitles/fetch", csrf: true, payload: { fileId: "111" } });
      expect(res.statusCode).toBe(422);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server subtitles: search is profile-scoped (a profile key overrides, no cross-profile leak)", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "erin", "erin-password");
    const erin = await login(app, "erin", "erin-password");

    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "opensubtitles", value: "os-server", label: "OS" },
    });
    await request(erin, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: { provider: "opensubtitles", value: "os-erin", label: "OS" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.opensubtitles.com/api/v1/subtitles")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const body = { data: [{ attributes: { language: "en", release: headers["Api-Key"], download_count: 1, files: [{ file_id: 1 }] } }] };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const releaseFor = async (client: typeof owner) =>
        json<{ results: Array<{ release: string }> }>(
          await request(client, { method: "POST", url: "/api/subtitles/search", csrf: true, payload: { imdbId: "tt1" } }),
        ).results[0].release;
      expect(await releaseFor(owner)).toBe("os-server"); // owner → shared server key
      expect(await releaseFor(erin)).toBe("os-erin"); // erin's profile override wins
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server subtitles translate: requires an AI key and translates cues preserving timing", async () => {
    const owner = await setupOwner(app);
    const cues = [{ start: 1000, end: 2000, text: "Hello world" }];

    const noKey = await request(owner, {
      method: "POST",
      url: "/api/subtitles/translate",
      csrf: true,
      payload: { cues, targetLanguage: "Spanish" },
    });
    expect(noKey.statusCode).toBe(400);
    expect(json<{ error: string }>(noKey).error).toMatch(/configure an ai provider/i);

    await request(owner, {
      method: "PUT",
      url: "/api/admin/credentials",
      csrf: true,
      payload: { provider: "anthropic", value: "sk", label: "AI" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://api.anthropic.com")) {
        // Echo the [[0]] marker with translated text, preserving the protocol.
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: "[[0]] Hola mundo" }], model: "m" }),
          { status: 200 },
        );
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    try {
      const res = await request(owner, {
        method: "POST",
        url: "/api/subtitles/translate",
        csrf: true,
        payload: { cues, targetLanguage: "Spanish" },
      });
      expect(res.statusCode).toBe(200);
      const out = json<{ cues: Array<{ start: number; end: number; text: string }>; providerKind: string }>(res);
      expect(out.providerKind).toBe("anthropic");
      expect(out.cues).toHaveLength(1);
      expect(out.cues[0].text).toBe("Hola mundo"); // translated
      expect(out.cues[0].start).toBe(1000); // timing preserved
      expect(out.cues[0].end).toBe(2000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("server subtitles fetch: SSRF-blocks an internal CDN download link when raw URLs are off", async () => {
    const hardened = await buildApp({
      config: {
        databasePath: ":memory:",
        dataDir: ".test-data",
        secretKey: randomBytes(32),
        cookieSecure: false,
        logger: false,
        allowRawStreamUrls: false,
      },
    });
    try {
      const owner = await setupOwner(hardened);
      await request(owner, {
        method: "PUT",
        url: "/api/admin/credentials",
        csrf: true,
        payload: { provider: "opensubtitles", value: "os-key", label: "OS" },
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url, init) => {
        if (String(url).startsWith("https://api.opensubtitles.com/api/v1/download")) {
          // A compromised/MITM'd API "returns" a link at the cloud-metadata address.
          return new Response(JSON.stringify({ link: "http://169.254.169.254/latest/meta-data/" }), { status: 200 });
        }
        return originalFetch(url, init);
      }) as typeof fetch;
      try {
        const res = await request(owner, { method: "POST", url: "/api/subtitles/fetch", csrf: true, payload: { fileId: "111" } });
        // The guard refuses the private address before fetching it → 502.
        expect(res.statusCode).toBe(502);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      await hardened.close();
    }
  });

  it("server subtitles translate: rate-limits per profile (10/min)", async () => {
    const owner = await setupOwner(app);
    const payload = { cues: [{ start: 0, end: 1000, text: "Hi" }], targetLanguage: "Spanish" };
    // No AI key configured: each call clears the rate limiter then 400s (missing
    // key). The limiter (10/min) trips the 11th call with a 429 before the handler.
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(owner, { method: "POST", url: "/api/subtitles/translate", csrf: true, payload });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
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

  it("kill-switch: admin revokes a stream session and the proxy then refuses it", async () => {
    upstream = createServer((_req, res) => {
      const body = Buffer.from("abcdefghij");
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
    await createProfile(owner, "carol", "carol-password");
    const carol = await login(app, "carol", "carol-password");

    // carol starts a stream session.
    const created = await request(carol, {
      method: "POST",
      url: "/api/streams/sessions/raw",
      csrf: true,
      payload: { upstreamUrl, contentType: "text/plain" },
    });
    expect(created.statusCode).toBe(200);
    const session = json<{ session: { id: string; playbackUrl: string } }>(created).session;

    // The fresh session shows up in the admin active-streams list (a full GET
    // would mark it completed and drop it from the list, so check it first).
    const active = await request(owner, { method: "GET", url: "/api/admin/streams/active" });
    expect(active.statusCode).toBe(200);
    expect(
      json<{ streams: Array<{ id: string }> }>(active).streams.some((s) => s.id === session.id),
    ).toBe(true);

    // Playback works before revocation.
    const before = await request(carol, { method: "GET", url: session.playbackUrl });
    expect(before.statusCode).toBe(200);

    // A non-admin cannot revoke.
    const carolRevoke = await request(carol, {
      method: "POST",
      url: `/api/admin/streams/${session.id}/revoke`,
      csrf: true,
    });
    expect(carolRevoke.statusCode).toBe(403);

    // Revoke without CSRF is rejected.
    const noCsrf = await request(owner, {
      method: "POST",
      url: `/api/admin/streams/${session.id}/revoke`,
    });
    expect(noCsrf.statusCode).toBe(403);

    // Admin revokes with CSRF.
    const revoke = await request(owner, {
      method: "POST",
      url: `/api/admin/streams/${session.id}/revoke`,
      csrf: true,
    });
    expect(revoke.statusCode).toBe(200);

    // The proxy now refuses the revoked session for its owner.
    const after = await request(carol, { method: "GET", url: session.playbackUrl });
    expect(after.statusCode).toBe(404);

    // Revoking again (already revoked) reports not-found.
    const again = await request(owner, {
      method: "POST",
      url: `/api/admin/streams/${session.id}/revoke`,
      csrf: true,
    });
    expect(again.statusCode).toBe(404);
  });

  it("restricted role: blocks management routes but allows browse + watchlist", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "rest", "rest-password", "restricted");
    await createProfile(owner, "memb", "memb-password", "member");
    const restricted = await login(app, "rest", "rest-password");
    const member = await login(app, "memb", "memb-password");

    // Management route (profile credential override) is blocked for restricted.
    // requireNotRestricted fires before body parsing, so the 403 is the role gate.
    const restrictedCred = await request(restricted, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: { provider: "tmdb", label: "Mine", value: "abc123" },
    });
    expect(restrictedCred.statusCode).toBe(403);

    // Profile management (PATCH) is blocked for restricted. The role gate runs
    // before the id/ownership check, so any id yields the same 403.
    const restrictedPatch = await request(restricted, {
      method: "PATCH",
      url: "/api/profiles/any-profile-id",
      csrf: true,
      payload: { displayName: "Hacker" },
    });
    expect(restrictedPatch.statusCode).toBe(403);

    // Browse/viewing data is allowed for restricted: write + read the watchlist.
    const restrictedWatchPut = await request(restricted, {
      method: "PUT",
      url: "/api/library/watchlist/tt0111161",
      csrf: true,
      payload: { preview: { id: "tt0111161", title: "Movie" } },
    });
    expect(restrictedWatchPut.statusCode).toBe(200);
    const restrictedWatchGet = await request(restricted, {
      method: "GET",
      url: "/api/library/watchlist",
    });
    expect(restrictedWatchGet.statusCode).toBe(200);

    // A member is unaffected: the same management route succeeds.
    const memberCred = await request(member, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: { provider: "tmdb", label: "Mine", value: "abc123" },
    });
    expect(memberCred.statusCode).toBe(200);

    // The owner is unaffected too.
    const ownerCred = await request(owner, {
      method: "PUT",
      url: "/api/profile/credentials",
      csrf: true,
      payload: { provider: "tmdb", label: "Owner", value: "abc123" },
    });
    expect(ownerCred.statusCode).toBe(200);
  });

  // ---- Household sub-profiles ("who's watching") ---------------------------

  interface AccountProfile {
    id: string;
    displayName: string;
    avatarColor: string | null;
    simpleMode: boolean;
    isDefault: boolean;
  }
  interface ProfileState {
    profiles: AccountProfile[];
    activeProfileId: string;
  }

  async function createAccountProfile(
    client: TestClient,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await request(client, {
      method: "POST",
      url: "/api/account/profiles",
      csrf: true,
      payload,
    });
    expect(response.statusCode).toBe(200);
    return json<{ profile: { id: string } }>(response).profile.id;
  }

  async function switchProfile(
    client: TestClient,
    profileId: string,
  ): Promise<LightMyRequestResponse> {
    return request(client, {
      method: "POST",
      url: "/api/profiles/switch",
      csrf: true,
      payload: { profileId },
    });
  }

  it("creates household sub-profiles under one account and lists them with the default first", async () => {
    const owner = await setupOwner(app);

    const initial = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    );
    expect(initial.profiles).toHaveLength(1);
    expect(initial.profiles[0]?.isDefault).toBe(true);
    expect(initial.activeProfileId).toBe(initial.profiles[0]?.id);

    // A viewer profile needs no username; password is optional.
    const kidId = await createAccountProfile(owner, {
      displayName: "Kid",
      avatarColor: "#22c55e",
    });

    const state = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    );
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0]?.isDefault).toBe(true); // default first
    const kid = state.profiles.find((p) => p.id === kidId);
    expect(kid).toMatchObject({ displayName: "Kid", avatarColor: "#22c55e", isDefault: false });

    // bootstrap + session both echo the picker payload.
    const boot = json<{ profiles: ProfileState | null }>(
      await request(owner, { method: "GET", url: "/api/bootstrap" }),
    );
    expect(boot.profiles?.profiles).toHaveLength(2);
    const session = json<{ profiles: ProfileState }>(
      await request(owner, { method: "GET", url: "/api/auth/session" }),
    );
    expect(session.profiles.profiles).toHaveLength(2);
  });

  it("switching the active profile changes the data scope (watchlist differs per profile)", async () => {
    const owner = await setupOwner(app);
    const defaultId = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    ).activeProfileId;
    const kidId = await createAccountProfile(owner, { displayName: "Kid" });

    // Default profile adds an item.
    await request(owner, {
      method: "PUT",
      url: "/api/library/watchlist/tt-default",
      csrf: true,
      payload: { preview: { id: "tt-default", title: "Default pick" } },
    });

    // Switch to the kid profile — session + active scope follow it.
    const switched = json<{ session: { profileId: string }; profiles: ProfileState }>(
      await switchProfile(owner, kidId),
    );
    expect(switched.session.profileId).toBe(kidId);
    expect(switched.profiles.activeProfileId).toBe(kidId);

    // The kid profile starts empty (data is isolated by the active profile).
    const kidWatchlist = json<{ items: unknown[] }>(
      await request(owner, { method: "GET", url: "/api/library/watchlist" }),
    );
    expect(kidWatchlist.items).toHaveLength(0);

    await request(owner, {
      method: "PUT",
      url: "/api/library/watchlist/tt-kid",
      csrf: true,
      payload: { preview: { id: "tt-kid", title: "Kid pick" } },
    });
    const kidAfter = json<{ items: Array<{ mediaId: string }> }>(
      await request(owner, { method: "GET", url: "/api/library/watchlist" }),
    );
    expect(kidAfter.items.map((i) => i.mediaId)).toEqual(["tt-kid"]);

    // Switch back to the default — its original item is intact, the kid's is not.
    await switchProfile(owner, defaultId);
    const defaultAfter = json<{ items: Array<{ mediaId: string }> }>(
      await request(owner, { method: "GET", url: "/api/library/watchlist" }),
    );
    expect(defaultAfter.items.map((i) => i.mediaId)).toEqual(["tt-default"]);
  });

  it("renames, recolors, and deletes a sub-profile but keeps the default protected", async () => {
    const owner = await setupOwner(app);
    const defaultId = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    ).activeProfileId;
    const kidId = await createAccountProfile(owner, { displayName: "Kid" });

    // Rename + recolor.
    const patched = json<{ profiles: AccountProfile[] }>(
      await request(owner, {
        method: "PATCH",
        url: `/api/account/profiles/${kidId}`,
        csrf: true,
        payload: { displayName: "Teen", avatarColor: "#6366f1" },
      }),
    );
    expect(patched.profiles.find((p) => p.id === kidId)).toMatchObject({
      displayName: "Teen",
      avatarColor: "#6366f1",
    });

    // The default profile can never be deleted.
    const deleteDefault = await request(owner, {
      method: "DELETE",
      url: `/api/account/profiles/${defaultId}`,
      csrf: true,
    });
    expect(deleteDefault.statusCode).toBe(400);

    // A non-default sub-profile deletes cleanly.
    const deleteKid = await request(owner, {
      method: "DELETE",
      url: `/api/account/profiles/${kidId}`,
      csrf: true,
    });
    expect(deleteKid.statusCode).toBe(200);
    const remaining = json<{ profiles: AccountProfile[] }>(deleteKid);
    expect(remaining.profiles).toHaveLength(1);
    expect(remaining.profiles[0]?.id).toBe(defaultId);
  });

  it("a session whose active profile is deleted falls back to the default", async () => {
    const owner = await setupOwner(app);
    const defaultId = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    ).activeProfileId;
    const kidId = await createAccountProfile(owner, { displayName: "Kid" });

    await switchProfile(owner, kidId);
    expect(
      json<{ session: { profileId: string } }>(
        await request(owner, { method: "GET", url: "/api/auth/session" }),
      ).session.profileId,
    ).toBe(kidId);

    // Delete the active profile, then confirm the session degrades to default.
    await request(owner, {
      method: "DELETE",
      url: `/api/account/profiles/${kidId}`,
      csrf: true,
    });
    expect(
      json<{ session: { profileId: string } }>(
        await request(owner, { method: "GET", url: "/api/auth/session" }),
      ).session.profileId,
    ).toBe(defaultId);
  });

  it("cannot switch to, read, rename, or delete another account's profile (IDOR-safe)", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "bob", "bob-password");
    const bob = await login(app, "bob", "bob-password");

    // Owner creates a household sub-profile.
    const ownerKidId = await createAccountProfile(owner, { displayName: "Owner Kid" });

    // bob's list never includes the owner's profiles.
    const bobState = json<ProfileState>(
      await request(bob, { method: "GET", url: "/api/account/profiles" }),
    );
    expect(bobState.profiles.some((p) => p.id === ownerKidId)).toBe(false);

    // bob cannot switch to the owner's profile.
    expect((await switchProfile(bob, ownerKidId)).statusCode).toBe(404);
    // bob cannot rename it.
    expect(
      (
        await request(bob, {
          method: "PATCH",
          url: `/api/account/profiles/${ownerKidId}`,
          csrf: true,
          payload: { displayName: "hacked" },
        })
      ).statusCode,
    ).toBe(404);
    // bob cannot delete it.
    expect(
      (
        await request(bob, {
          method: "DELETE",
          url: `/api/account/profiles/${ownerKidId}`,
          csrf: true,
        })
      ).statusCode,
    ).toBe(404);

    // The owner's profile is untouched.
    const ownerState = json<ProfileState>(
      await request(owner, { method: "GET", url: "/api/account/profiles" }),
    );
    expect(ownerState.profiles.find((p) => p.id === ownerKidId)?.displayName).toBe("Owner Kid");
  });

  it("requires auth and CSRF for sub-profile mutations", async () => {
    const owner = await setupOwner(app);
    const kidId = await createAccountProfile(owner, { displayName: "Kid" });

    // Unauthenticated client.
    const anon: TestClient = { app, cookies: new Map() };
    expect(
      (await request(anon, { method: "GET", url: "/api/account/profiles" })).statusCode,
    ).toBe(401);

    // Authenticated but missing CSRF → 403 on every unsafe route.
    expect(
      (
        await request(owner, {
          method: "POST",
          url: "/api/account/profiles",
          payload: { displayName: "NoCsrf" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await request(owner, { method: "POST", url: "/api/profiles/switch", payload: { profileId: kidId } })).statusCode).toBe(403);
    expect(
      (await request(owner, { method: "PATCH", url: `/api/account/profiles/${kidId}`, payload: { displayName: "x" } })).statusCode,
    ).toBe(403);
    expect(
      (await request(owner, { method: "DELETE", url: `/api/account/profiles/${kidId}` })).statusCode,
    ).toBe(403);
  });

  it("restricted role cannot create/manage household sub-profiles", async () => {
    const owner = await setupOwner(app);
    await createProfile(owner, "limited", "limited-password", "restricted");
    const limited = await login(app, "limited", "limited-password");
    // A restricted account can switch among its own profiles (a viewing
    // convenience) but cannot create/rename/delete them (management).
    expect(
      (await request(limited, { method: "POST", url: "/api/account/profiles", csrf: true, payload: { displayName: "Kid" } })).statusCode,
    ).toBe(403);
  });

  it("never leaks or lets the client overwrite the protected sub-profile password hash", async () => {
    const owner = await setupOwner(app);
    // A household sub-profile created WITH a password stores a write-only hash.
    const sub = json<{ profile: { id: string } }>(
      await request(owner, {
        method: "POST",
        url: "/api/account/profiles",
        csrf: true,
        payload: { displayName: "Kid", password: "kid-pin-1234" },
      }),
    ).profile.id;
    // Switch to it so /api/settings/profile reads that profile's settings.
    expect(
      (await request(owner, { method: "POST", url: "/api/profiles/switch", csrf: true, payload: { profileId: sub } })).statusCode,
    ).toBe(200);
    const settings = json<{ settings: Record<string, string> }>(
      await request(owner, { method: "GET", url: "/api/settings/profile" }),
    ).settings;
    expect(settings.profile_password_hash).toBeUndefined(); // not leaked on read
    // And the generic settings PUT cannot overwrite/delete the protected key.
    expect(
      (await request(owner, {
        method: "PUT",
        url: "/api/settings/profile",
        csrf: true,
        payload: { key: "profile_password_hash", value: "attacker" },
      })).statusCode,
    ).toBe(403);
  });
});
