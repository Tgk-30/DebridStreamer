// storage/index — getStore() / getSecretStore() backend selection.
//
// index.ts holds process-wide singletons, so each test resets the module
// registry (vi.resetModules) and re-imports a fresh copy after configuring the
// isTauri() / configuredServerURL() mocks. The concrete store classes are
// mocked to lightweight tagged stand-ins so this test exercises ONLY the
// selection logic (Local vs Server, browser vs Tauri-keychain) without pulling
// in Dexie/IndexedDB or fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock state the per-test modules read through the mocked modules below.
let serverURL: string | null = null;
let tauri = false;

vi.mock("../lib/serverMode", () => ({
  configuredServerURL: () => serverURL,
}));

vi.mock("../lib/tauri", () => ({
  isTauri: () => tauri,
}));

vi.mock("./DexieStore", () => ({
  DexieStore: class {
    readonly kind = "dexie";
  },
}));

vi.mock("./RemoteStore", () => ({
  RemoteStore: class {
    readonly kind = "remote";
    constructor(public readonly baseURL: string) {}
  },
}));

vi.mock("./KeychainSecretStore", () => ({
  KeychainSecretStore: class {
    readonly kind = "keychain";
    constructor(public readonly fallback: unknown) {}
  },
}));

async function freshIndex() {
  vi.resetModules();
  return import("./index");
}

beforeEach(() => {
  serverURL = null;
  tauri = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getStore()", () => {
  it("returns a DexieStore in plain Local Mode (no server URL)", async () => {
    const mod = await freshIndex();
    const store = mod.getStore() as unknown as { kind: string };
    expect(store.kind).toBe("dexie");
  });

  it("returns a RemoteStore wired to the configured server URL in Server Mode", async () => {
    serverURL = "http://my-server:8080";
    const mod = await freshIndex();
    const store = mod.getStore() as unknown as { kind: string; baseURL: string };
    expect(store.kind).toBe("remote");
    expect(store.baseURL).toBe("http://my-server:8080");
  });

  it("memoizes the singleton across calls", async () => {
    const mod = await freshIndex();
    expect(mod.getStore()).toBe(mod.getStore());
  });

  it("uses the same Dexie singleton in Tauri Local Mode (IndexedDB works in the webview)", async () => {
    tauri = true;
    const mod = await freshIndex();
    expect((mod.getStore() as unknown as { kind: string }).kind).toBe("dexie");
  });
});

describe("getSecretStore()", () => {
  it("returns a plain DexieStore in a browser (no Tauri, no server)", async () => {
    const mod = await freshIndex();
    const secret = mod.getSecretStore() as unknown as { kind: string };
    expect(secret.kind).toBe("dexie");
  });

  it("wraps Dexie in a KeychainSecretStore under Tauri", async () => {
    tauri = true;
    const mod = await freshIndex();
    const secret = mod.getSecretStore() as unknown as { kind: string; fallback: { kind: string } };
    expect(secret.kind).toBe("keychain");
    // The keychain store keeps the Dexie instance only for legacy migration.
    expect(secret.fallback.kind).toBe("dexie");
  });

  it("returns the RemoteStore itself as the SecretStore in Server Mode (write-only)", async () => {
    serverURL = "http://srv";
    const mod = await freshIndex();
    const secret = mod.getSecretStore() as unknown as { kind: string };
    // Same instance as the store — RemoteStore implements both interfaces.
    expect(secret).toBe(mod.getStore());
    expect(secret.kind).toBe("remote");
  });

  it("Server Mode takes precedence over Tauri for the secret backend (no keychain)", async () => {
    serverURL = "http://srv";
    tauri = true;
    const mod = await freshIndex();
    expect((mod.getSecretStore() as unknown as { kind: string }).kind).toBe("remote");
  });

  it("memoizes the secret singleton across calls", async () => {
    tauri = true;
    const mod = await freshIndex();
    expect(mod.getSecretStore()).toBe(mod.getSecretStore());
  });

  it("shares one underlying Dexie instance between the store and the keychain fallback", async () => {
    tauri = true;
    const mod = await freshIndex();
    const store = mod.getStore();
    const secret = mod.getSecretStore() as unknown as { fallback: unknown };
    // getSecretStore's keychain fallback is the very same DexieStore getStore() returns.
    expect(secret.fallback).toBe(store);
  });
});

describe("__setStoreForTesting()", () => {
  it("replaces the store singleton and resets the secret-store cache", async () => {
    const mod = await freshIndex();
    // Prime both singletons (browser → Dexie for both).
    const original = mod.getStore();
    mod.getSecretStore();

    const injected = { kind: "injected" } as never;
    mod.__setStoreForTesting(injected);

    // getStore now returns the injected instance.
    expect(mod.getStore()).toBe(injected);
    expect(mod.getStore()).not.toBe(original);

    // The secret cache was cleared, so a fresh selection runs; in a plain browser
    // it re-selects the (newly injected) Dexie singleton.
    expect(mod.getSecretStore()).toBe(injected);
  });

  it("clearing to null forces getStore() to build a fresh Dexie store", async () => {
    const mod = await freshIndex();
    mod.__setStoreForTesting(null);
    expect((mod.getStore() as unknown as { kind: string }).kind).toBe("dexie");
  });
});
