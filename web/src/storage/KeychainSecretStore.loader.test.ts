import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretStore } from "./types";

// This suite verifies the fail-safe path when the Tauri bridge cannot load.
vi.mock("@tauri-apps/api/core", () => {
  throw new Error("tauri bridge missing");
});

describe("KeychainSecretStore loadInvoke resilience", () => {
  let KeychainSecretStore: typeof import("./KeychainSecretStore").KeychainSecretStore;

  beforeEach(async () => {
    vi.resetModules();
    ({ KeychainSecretStore } = await import("./KeychainSecretStore"));
  });

  it("returns null when the keychain module cannot be imported", async () => {
    const store = new KeychainSecretStore({
      getSecret: async () => "legacy",
      setSecret: async () => undefined,
      deleteSecret: async () => undefined,
    } as SecretStore);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(store.getSecret("k")).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
