// Local profile registry. This database is intentionally independent from the
// active profile database so switching profiles never changes its own records.

import Dexie, { type Table } from "dexie";

export interface LocalProfile {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
  isDefault: boolean;
  isAdmin: boolean;
  passwordHash?: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface MetaRecord {
  key: "activeProfileId" | "multiUserEnabled" | "autoEnterProfileId";
  value: string | boolean;
}

class ProfileRegistry extends Dexie {
  profiles!: Table<LocalProfile, string>;
  meta!: Table<MetaRecord, MetaRecord["key"]>;

  constructor() {
    super("debridstreamer_profiles");
    this.version(1).stores({
      profiles: "id, createdAt",
      meta: "key",
    });
  }
}

const registry = new ProfileRegistry();

export function dbNameForProfile(
  profileOrId: Pick<LocalProfile, "id" | "isDefault"> | string,
  isDefault?: boolean,
): string {
  const id = typeof profileOrId === "string" ? profileOrId : profileOrId.id;
  const defaultProfile = typeof profileOrId === "string" ? isDefault : profileOrId.isDefault;
  return defaultProfile ? "debridstreamer" : `debridstreamer_p_${id}`;
}

export async function listProfiles(): Promise<LocalProfile[]> {
  return registry.profiles.orderBy("createdAt").toArray();
}

export async function getProfile(id: string): Promise<LocalProfile | undefined> {
  return registry.profiles.get(id);
}

export async function createProfileRecord(profile: LocalProfile): Promise<void> {
  await registry.profiles.add(profile);
}

export async function updateProfileRecord(
  id: string,
  patch: Partial<LocalProfile>,
): Promise<void> {
  await registry.profiles.update(id, patch);
}

export async function deleteProfileRecord(id: string): Promise<void> {
  await registry.profiles.delete(id);
}

export async function getActiveProfileId(): Promise<string | null> {
  const record = await registry.meta.get("activeProfileId");
  return typeof record?.value === "string" ? record.value : null;
}

export async function setActiveProfileId(id: string): Promise<void> {
  await registry.meta.put({ key: "activeProfileId", value: id });
}

/** The profile to enter at launch without asking, bypassing the "Who's watching?"
 * choice. null (the default) means always ask when there are several profiles.
 *
 * This lives in the registry, not in AppSettings: it decides WHICH profile's
 * settings to load, so it cannot be stored inside a profile's own database.
 *
 * A password is never bypassed by this - the lock prompt is a separate gate that
 * still runs for a protected profile. */
export async function getAutoEnterProfileId(): Promise<string | null> {
  const record = await registry.meta.get("autoEnterProfileId");
  return typeof record?.value === "string" ? record.value : null;
}

export async function setAutoEnterProfileId(id: string | null): Promise<void> {
  if (id == null) {
    await registry.meta.delete("autoEnterProfileId");
    return;
  }
  await registry.meta.put({ key: "autoEnterProfileId", value: id });
}

export async function isMultiUserEnabled(): Promise<boolean> {
  const record = await registry.meta.get("multiUserEnabled");
  return typeof record?.value === "boolean" ? record.value : true;
}

export async function setMultiUserEnabled(enabled: boolean): Promise<void> {
  await registry.meta.put({ key: "multiUserEnabled", value: enabled });
}

export async function ensureDefaultProfile(seed: {
  name?: string;
  avatar?: string;
}): Promise<LocalProfile> {
  const existing = await listProfiles();
  const defaultProfile = existing.find((profile) => profile.id === "default");
  if (defaultProfile != null) {
    if ((await getActiveProfileId()) == null) await setActiveProfileId(defaultProfile.id);
    return defaultProfile;
  }
  // A registry should never have profiles without its default owner, but avoid
  // overwriting persisted records if an older experimental build left some.
  if (existing.length > 0) {
    const first = existing[0]!;
    if ((await getActiveProfileId()) == null) await setActiveProfileId(first.id);
    return first;
  }
  const profile: LocalProfile = {
    id: "default",
    name: seed.name?.trim() || "You",
    avatar: seed.avatar || undefined,
    isDefault: true,
    isAdmin: true,
    createdAt: Date.now(),
  };
  // put (not add): a StrictMode double-mount runs two boot passes that both see
  // an empty registry; add would throw ConstraintError on the second and, with
  // the boot guard, silently drop the second pass. put is idempotent.
  await registry.profiles.put(profile);
  await setActiveProfileId(profile.id);
  return profile;
}

/** Test-only cleanup hook for the independent registry database. */
export async function __resetProfileRegistryForTesting(): Promise<void> {
  await registry.delete();
  await registry.open();
}

/** Close the registry before deleting every local DebridStreamer database. */
export function closeProfileRegistry(): void {
  registry.close();
}
