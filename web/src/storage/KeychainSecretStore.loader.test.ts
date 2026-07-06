import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretStore } from "./types";

// For this suite we want the Tauri import to fail at load time.
vi.mock("@tauri-apps/api/core", () => {
  throw new Error("tauri bridge missing");
});

describe("KeychainSecretStore loadInvoke resilience", () => {
  let KeychainSecretStore: typeof import('./KeychainSecretStore').KeychainSecretStore;

  beforeEach(async () => {
    vi.resetModules();
    ({ KeychainSecretStore } = await import('./KeychainSecretStore'));
  });

  it("returns null when keychain module cannot be imported", async () => {
    const store = new KeychainSecretStore({
      getSecret: async () => "legacy",
      setSecret: async () => undefined,
      deleteSecret: async () => undefined,
    } as SecretStore);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(store.getSecret("k")).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
