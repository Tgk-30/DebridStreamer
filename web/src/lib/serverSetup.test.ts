import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DexieStore } from "../storage/DexieStore";
import { __setStoreForTesting } from "../storage";
import {
  markServerSetupComplete,
  serverNeedsSetup,
  shouldShowServerSetup,
} from "./serverSetup";

let counter = 0;

describe("serverSetup", () => {
  beforeEach(() => {
    counter += 1;
    __setStoreForTesting(new DexieStore(`server-setup-${counter}-${Date.now()}`));
  });
  afterEach(() => {
    __setStoreForTesting(null);
  });

  describe("serverNeedsSetup", () => {
    it("offers setup to a fresh owner (no credentials)", () => {
      expect(serverNeedsSetup({ role: "owner", credentialCount: 0 })).toBe(true);
    });

    it("does not offer setup once credentials exist", () => {
      expect(serverNeedsSetup({ role: "owner", credentialCount: 3 })).toBe(false);
    });

    it("never offers setup to non-owners", () => {
      expect(serverNeedsSetup({ role: "admin", credentialCount: 0 })).toBe(false);
      expect(serverNeedsSetup({ role: "member", credentialCount: 0 })).toBe(false);
      expect(serverNeedsSetup({ role: "restricted", credentialCount: 0 })).toBe(
        false,
      );
    });
  });

  describe("shouldShowServerSetup", () => {
    it("shows for a fresh owner who hasn't finished setup", async () => {
      await expect(
        shouldShowServerSetup({ role: "owner", credentialCount: 0 }),
      ).resolves.toBe(true);
    });

    it("hides after setup is marked complete", async () => {
      await markServerSetupComplete();
      await expect(
        shouldShowServerSetup({ role: "owner", credentialCount: 0 }),
      ).resolves.toBe(false);
    });

    it("hides when the server already has credentials", async () => {
      await expect(
        shouldShowServerSetup({ role: "owner", credentialCount: 2 }),
      ).resolves.toBe(false);
    });

    it("hides for non-owners regardless of the flag", async () => {
      await expect(
        shouldShowServerSetup({ role: "member", credentialCount: 0 }),
      ).resolves.toBe(false);
    });

    it("hides (fails safe) when reading the persisted flag throws", async () => {
      // Inject a store whose getSetting rejects, exercising the catch that must
      // NOT trap the owner behind setup when the store can't be read.
      const throwingStore = {
        getSetting: vi.fn(async () => {
          throw new Error("store read failed");
        }),
      } as unknown as DexieStore;
      __setStoreForTesting(throwingStore);
      await expect(
        shouldShowServerSetup({ role: "owner", credentialCount: 0 }),
      ).resolves.toBe(false);
      expect(throwingStore.getSetting).toHaveBeenCalled();
    });
  });
});
