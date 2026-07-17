import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetProfileRegistryForTesting,
  createProfileRecord,
  dbNameForProfile,
  deleteProfileRecord,
  ensureDefaultProfile,
  getActiveProfileId,
  getProfile,
  isMultiUserEnabled,
  listProfiles,
  setActiveProfileId,
  setMultiUserEnabled,
  updateProfileRecord,
} from "./ProfileRegistry";

afterEach(async () => {
  await __resetProfileRegistryForTesting();
});

describe("ProfileRegistry", () => {
  it("creates, reads, updates, and deletes registry profiles", async () => {
    await createProfileRecord({
      id: "one", name: "One", isDefault: false, isAdmin: false, createdAt: 1,
    });
    expect(await listProfiles()).toHaveLength(1);
    await updateProfileRecord("one", { name: "Renamed", color: "#7c5cff" });
    expect(await getProfile("one")).toMatchObject({ name: "Renamed", color: "#7c5cff" });
    await deleteProfileRecord("one");
    expect(await getProfile("one")).toBeUndefined();
  });

  it("seeds the default owner and tracks the active id", async () => {
    const profile = await ensureDefaultProfile({ name: "Brendan", avatar: "🎬" });
    expect(profile).toMatchObject({ id: "default", isDefault: true, isAdmin: true, name: "Brendan", avatar: "🎬" });
    expect(await getActiveProfileId()).toBe("default");
    await setActiveProfileId("other");
    expect(await getActiveProfileId()).toBe("other");
  });

  it("defaults multi-user to enabled and persists its setting", async () => {
    expect(await isMultiUserEnabled()).toBe(true);
    await setMultiUserEnabled(false);
    expect(await isMultiUserEnabled()).toBe(false);
  });

  it("uses the legacy database for default and a named database for others", () => {
    expect(dbNameForProfile({ id: "default", isDefault: true })).toBe("debridstreamer");
    expect(dbNameForProfile({ id: "abc", isDefault: false })).toBe("debridstreamer_p_abc");
  });
});
