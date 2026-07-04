import { describe, expect, it, vi } from "vitest";
import { readModelCache, writeModelCache } from "./ModelCache";
import type { Store } from "../../storage/types";

/** A minimal in-memory Store double exposing just getSetting/setSetting. */
function fakeStore(initial: Record<string, string> = {}): Store {
  const kv = new Map(Object.entries(initial));
  return {
    getSetting: vi.fn(async (k: string) => kv.get(k) ?? null),
    setSetting: vi.fn(async (k: string, v: string | null) => {
      if (v == null) kv.delete(k);
      else kv.set(k, v);
    }),
  } as unknown as Store;
}

const HOUR = 60 * 60 * 1000;

describe("ModelCache", () => {
  it("round-trips a written list and reports it fresh within the TTL", async () => {
    const store = fakeStore();
    const t0 = 1_000_000_000_000;
    await writeModelCache(store, "openai", ["gpt-5", "gpt-5-mini"], t0);
    const entry = await readModelCache(store, "openai", t0 + HOUR);
    expect(entry).not.toBeNull();
    expect(entry!.models).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(entry!.fetchedAt).toBe(t0);
    expect(entry!.stale).toBe(false);
  });

  it("marks an entry stale past the 24h TTL (but still returns it)", async () => {
    const store = fakeStore();
    const t0 = 1_000_000_000_000;
    await writeModelCache(store, "anthropic", ["claude-opus-4-8"], t0);
    const entry = await readModelCache(store, "anthropic", t0 + 25 * HOUR);
    expect(entry).not.toBeNull();
    expect(entry!.models).toEqual(["claude-opus-4-8"]);
    expect(entry!.stale).toBe(true);
  });

  it("returns null on a cache miss", async () => {
    const store = fakeStore();
    expect(await readModelCache(store, "groq")).toBeNull();
  });

  it("tolerates a malformed envelope", async () => {
    const store = fakeStore({ "ai.modelCache.openai": "not json {" });
    expect(await readModelCache(store, "openai")).toBeNull();
  });

  it("rejects an envelope with the wrong shape", async () => {
    const store = fakeStore({
      "ai.modelCache.openai": JSON.stringify({ models: "nope", fetchedAt: 123 }),
    });
    expect(await readModelCache(store, "openai")).toBeNull();
  });

  it("keys the cache per provider", async () => {
    const store = fakeStore();
    await writeModelCache(store, "openai", ["gpt-5"], 1);
    await writeModelCache(store, "mistral", ["mistral-large-latest"], 1);
    expect((await readModelCache(store, "openai"))!.models).toEqual(["gpt-5"]);
    expect((await readModelCache(store, "mistral"))!.models).toEqual([
      "mistral-large-latest",
    ]);
  });

  it("drops non-string entries defensively", async () => {
    const store = fakeStore({
      "ai.modelCache.openai": JSON.stringify({
        models: ["gpt-5", 42, null, "o4-mini"],
        fetchedAt: new Date(1).toISOString(),
      }),
    });
    const entry = await readModelCache(store, "openai", 2);
    expect(entry!.models).toEqual(["gpt-5", "o4-mini"]);
  });
});
