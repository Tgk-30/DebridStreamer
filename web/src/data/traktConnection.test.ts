import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TraktTokenResponse } from "../services/sync/models";

// In-memory KV + secret stores the module writes through.
const kv = new Map<string, string>();
const secrets = new Map<string, string>();

vi.mock("../storage", () => ({
  getStore: () => ({
    getSetting: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
    setSetting: async (k: string, v: string | null) => {
      if (v == null) kv.delete(k);
      else kv.set(k, v);
    },
  }),
  getSecretStore: () => ({
    getSecret: async (k: string) => (secrets.has(k) ? secrets.get(k)! : null),
    setSecret: async (k: string, v: string) => void secrets.set(k, v),
    deleteSecret: async (k: string) => void secrets.delete(k),
  }),
}));

import {
  saveTraktTokens,
  loadTraktConnection,
  isTraktConnected,
  clearTraktConnection,
  getValidAccessToken,
} from "./traktConnection";
import { TraktSyncService } from "../services/sync/TraktSyncService";

function token(overrides: Partial<TraktTokenResponse> = {}): TraktTokenResponse {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresIn: 7776000, // 90 days
    tokenType: "bearer",
    scope: "public",
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

beforeEach(() => {
  kv.clear();
  secrets.clear();
});

describe("traktConnection", () => {
  it("stores tokens in the secret store and metadata in KV", async () => {
    await saveTraktTokens(token(), "alice");
    expect(secrets.get("trakt.access_token")).toBe("access-1");
    expect(secrets.get("trakt.refresh_token")).toBe("refresh-1");
    // The plaintext KV blob must never contain the tokens.
    expect(kv.get("trakt_token_meta")).not.toContain("access-1");
    expect(kv.get("trakt_token_meta")).not.toContain("refresh-1");
    expect(kv.get("trakt_token_meta")).toContain("alice");
  });

  it("round-trips a saved connection", async () => {
    await saveTraktTokens(token(), "alice");
    const conn = await loadTraktConnection();
    expect(conn?.accessToken).toBe("access-1");
    expect(conn?.refreshToken).toBe("refresh-1");
    expect(conn?.meta.username).toBe("alice");
    expect(await isTraktConnected()).toBe(true);
  });

  it("reads as disconnected when tokens are missing but meta remains", async () => {
    await saveTraktTokens(token());
    secrets.delete("trakt.access_token");
    // Partial state must not present as a usable connection.
    expect(await loadTraktConnection()).toBeNull();
  });

  it("clears both tokens and the meta on disconnect", async () => {
    await saveTraktTokens(token());
    await clearTraktConnection();
    expect(kv.has("trakt_token_meta")).toBe(false);
    expect(secrets.has("trakt.access_token")).toBe(false);
    expect(secrets.has("trakt.refresh_token")).toBe(false);
    expect(await isTraktConnected()).toBe(false);
  });

  it("returns the stored token when it is still valid", async () => {
    await saveTraktTokens(token());
    const svc = new TraktSyncService();
    const refreshSpy = vi.spyOn(svc, "refreshToken");
    const at = await getValidAccessToken(svc, "cid", "csecret");
    expect(at).toBe("access-1");
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("refreshes and re-persists an expired token", async () => {
    // Issued long ago so isExpired() (with its 24h buffer) is true.
    await saveTraktTokens(token({ createdAt: 1000, expiresIn: 3600 }));
    const svc = new TraktSyncService();
    vi.spyOn(svc, "refreshToken").mockResolvedValue(
      token({ accessToken: "access-2", refreshToken: "refresh-2" }),
    );
    const at = await getValidAccessToken(svc, "cid", "csecret");
    expect(at).toBe("access-2");
    // The refreshed token is persisted for the next call.
    expect(secrets.get("trakt.access_token")).toBe("access-2");
    expect(secrets.get("trakt.refresh_token")).toBe("refresh-2");
  });

  it("returns null when not connected", async () => {
    const svc = new TraktSyncService();
    expect(await getValidAccessToken(svc, "cid", "csecret")).toBeNull();
  });
});
