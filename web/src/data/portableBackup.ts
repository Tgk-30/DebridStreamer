import { DexieStore, getStore } from "../storage";
import {
  createProfileRecord,
  dbNameForProfile,
  getActiveProfileId,
  getAutoEnterProfileId,
  isMultiUserEnabled,
  listProfiles,
  setActiveProfileId,
  setAutoEnterProfileId,
  setMultiUserEnabled,
  updateProfileRecord,
  type LocalProfile,
} from "../storage/ProfileRegistry";

const BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const PORTABLE_TABLES = [
  "settings",
  "watchlist",
  "watchlistFolders",
  "watchHistory",
  "library",
  "folders",
  "tasteEvents",
  "mediaCache",
  "aiUsage",
] as const;

const SECRET_SETTING_KEYS = new Set([
  "tmdb_api_key",
  "trakt_client_id",
  "trakt_client_secret",
  "omdb_api_key",
  "ai_api_key",
  "opensubtitles_api_key",
]);

type PortableTableName = (typeof PORTABLE_TABLES)[number];
type PortableRows = Record<PortableTableName, Array<Record<string, unknown>>>;

type PortableProfile = Omit<LocalProfile, "passwordHash">;

interface PortableProfileData {
  profile: PortableProfile;
  databaseName: string;
  data: PortableRows;
}

export interface PortableBackup {
  product: "YAWF Stream";
  format: "yawf-local-backup";
  version: typeof BACKUP_VERSION;
  createdAt: string;
  activeProfileId: string;
  autoEnterProfileId: string | null;
  multiUserEnabled: boolean;
  exclusions: string[];
  profiles: PortableProfileData[];
}

function requireLocalStore(store = getStore()): DexieStore {
  if (!(store instanceof DexieStore)) {
    throw new Error("Local backup is available only in Local Mode.");
  }
  return store;
}

function isPortableSetting(row: unknown): row is { key: string; value: string } {
  if (row == null || typeof row !== "object") return false;
  const candidate = row as { key?: unknown; value?: unknown };
  return (
    typeof candidate.key === "string" &&
    typeof candidate.value === "string" &&
    !SECRET_SETTING_KEYS.has(candidate.key) &&
    !candidate.value.startsWith("secret:")
  );
}

function sanitizeProfile(profile: LocalProfile): PortableProfile {
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.avatar == null ? {} : { avatar: profile.avatar }),
    ...(profile.color == null ? {} : { color: profile.color }),
    isDefault: profile.isDefault,
    isAdmin: profile.isAdmin,
    createdAt: profile.createdAt,
    ...(profile.lastUsedAt == null ? {} : { lastUsedAt: profile.lastUsedAt }),
  };
}

async function exportRows(local: DexieStore): Promise<PortableRows> {
  const data = {} as PortableRows;
  for (const tableName of PORTABLE_TABLES) {
    const rows = (await local.table(tableName).toArray()) as Array<
      Record<string, unknown>
    >;
    data[tableName] =
      tableName === "settings" ? rows.filter(isPortableSetting) : rows;
  }
  return data;
}

async function withProfileStore<T>(
  databaseName: string,
  activeStore: DexieStore,
  work: (store: DexieStore) => Promise<T>,
): Promise<T> {
  if (activeStore.name === databaseName) return work(activeStore);
  const temporaryStore = new DexieStore(databaseName);
  try {
    await temporaryStore.open();
    return await work(temporaryStore);
  } finally {
    temporaryStore.close();
  }
}

export async function exportPortableBackup(
  explicitStore?: DexieStore,
): Promise<PortableBackup> {
  const activeStore = requireLocalStore(explicitStore);
  const registryProfiles = explicitStore == null ? await listProfiles() : [];
  const profiles: LocalProfile[] =
    registryProfiles.length > 0
      ? registryProfiles
      : [
          {
            id: "default",
            name: "You",
            isDefault: true,
            isAdmin: true,
            createdAt: Date.now(),
          },
        ];
  const activeProfileId =
    explicitStore == null ? (await getActiveProfileId()) ?? profiles[0]!.id : profiles[0]!.id;
  const profileData: PortableProfileData[] = [];

  for (const profile of profiles) {
    const databaseName =
      explicitStore != null ? explicitStore.name : dbNameForProfile(profile);
    const data = await withProfileStore(databaseName, activeStore, exportRows);
    profileData.push({
      profile: sanitizeProfile(profile),
      databaseName,
      data,
    });
  }

  return {
    product: "YAWF Stream",
    format: "yawf-local-backup",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    activeProfileId,
    autoEnterProfileId:
      explicitStore == null ? await getAutoEnterProfileId() : activeProfileId,
    multiUserEnabled:
      explicitStore == null ? await isMultiUserEnabled() : profiles.length > 1,
    exclusions: [
      "credentials and API keys",
      "profile password hashes",
      "resolved stream URLs",
      "device-specific download paths",
    ],
    profiles: profileData,
  };
}

function isPortableProfile(value: unknown): value is PortableProfile {
  if (value == null || typeof value !== "object") return false;
  const profile = value as Partial<PortableProfile> & { passwordHash?: unknown };
  return (
    typeof profile.id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(profile.id) &&
    typeof profile.name === "string" &&
    profile.name.trim().length > 0 &&
    profile.name.length <= 80 &&
    typeof profile.isDefault === "boolean" &&
    typeof profile.isAdmin === "boolean" &&
    typeof profile.createdAt === "number" &&
    Number.isFinite(profile.createdAt) &&
    profile.passwordHash == null
  );
}

function validateRows(data: unknown): asserts data is PortableRows {
  if (data == null || typeof data !== "object") {
    throw new Error("Backup profile data is missing or invalid.");
  }
  const rows = data as Partial<PortableRows>;
  for (const tableName of PORTABLE_TABLES) {
    if (!Array.isArray(rows[tableName])) {
      throw new Error(`Backup table "${tableName}" is missing or invalid.`);
    }
  }
  if (!rows.settings!.every(isPortableSetting)) {
    throw new Error("Backup contains a secret-valued setting.");
  }
}

function validateBackup(value: unknown): asserts value is PortableBackup {
  if (value == null || typeof value !== "object") {
    throw new Error("Backup is not a JSON object.");
  }
  const candidate = value as Partial<PortableBackup>;
  if (
    candidate.product !== "YAWF Stream" ||
    candidate.format !== "yawf-local-backup" ||
    candidate.version !== BACKUP_VERSION ||
    !Array.isArray(candidate.profiles) ||
    candidate.profiles.length === 0 ||
    typeof candidate.activeProfileId !== "string" ||
    typeof candidate.multiUserEnabled !== "boolean" ||
    !(candidate.autoEnterProfileId == null || typeof candidate.autoEnterProfileId === "string")
  ) {
    throw new Error("Backup format or version is not supported.");
  }

  const ids = new Set<string>();
  let defaultProfiles = 0;
  for (const entry of candidate.profiles) {
    if (
      entry == null ||
      typeof entry !== "object" ||
      !isPortableProfile(entry.profile) ||
      typeof entry.databaseName !== "string" ||
      entry.databaseName.length === 0
    ) {
      throw new Error("Backup contains an invalid local profile.");
    }
    if (ids.has(entry.profile.id)) {
      throw new Error("Backup contains duplicate local profile IDs.");
    }
    ids.add(entry.profile.id);
    if (entry.profile.isDefault) defaultProfiles += 1;
    validateRows(entry.data);
  }
  if (defaultProfiles !== 1 || !ids.has(candidate.activeProfileId)) {
    throw new Error("Backup profile selection metadata is invalid.");
  }
  if (candidate.autoEnterProfileId != null && !ids.has(candidate.autoEnterProfileId)) {
    throw new Error("Backup automatic profile selection is invalid.");
  }
}

export function parsePortableBackup(text: string): PortableBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("Backup is larger than the 100 MB safety limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Backup is not valid JSON.");
  }
  validateBackup(value);
  return value;
}

async function restoreRows(local: DexieStore, data: PortableRows): Promise<number> {
  const tables = PORTABLE_TABLES.map((name) => local.table(name));
  let restoredRows = 0;
  await local.transaction("rw", tables, async () => {
    for (const tableName of PORTABLE_TABLES) {
      const rows = data[tableName];
      const table = local.table(tableName);
      if (tableName === "settings") {
        await table
          .filter((row: { key?: unknown }) =>
            typeof row.key === "string" ? !SECRET_SETTING_KEYS.has(row.key) : true,
          )
          .delete();
      } else {
        await table.clear();
      }
      if (rows.length > 0) {
        await table.bulkPut(rows);
        restoredRows += rows.length;
      }
    }
  });
  return restoredRows;
}

export async function restorePortableBackup(
  backupValue: PortableBackup,
  explicitStore?: DexieStore,
): Promise<{
  preRestoreBackup: PortableBackup;
  restoredRows: number;
  restoredProfiles: number;
  unlockedProfiles: number;
}> {
  validateBackup(backupValue);
  const activeStore = requireLocalStore(explicitStore);
  const preRestoreBackup = await exportPortableBackup(explicitStore);
  let restoredRows = 0;
  let unlockedProfiles = 0;

  if (explicitStore != null) {
    restoredRows = await restoreRows(explicitStore, backupValue.profiles[0]!.data);
    return {
      preRestoreBackup,
      restoredRows,
      restoredProfiles: 1,
      unlockedProfiles: 0,
    };
  }

  const existingProfiles = await listProfiles();
  const existingById = new Map(existingProfiles.map((profile) => [profile.id, profile]));
  for (const entry of backupValue.profiles) {
    const existing = existingById.get(entry.profile.id);
    if (existing == null) {
      await createProfileRecord(entry.profile);
      unlockedProfiles += 1;
    } else {
      await updateProfileRecord(entry.profile.id, {
        name: entry.profile.name,
        avatar: entry.profile.avatar,
        color: entry.profile.color,
        isDefault: entry.profile.isDefault,
        isAdmin: entry.profile.isAdmin,
        createdAt: entry.profile.createdAt,
        lastUsedAt: entry.profile.lastUsedAt,
      });
    }

    const databaseName = dbNameForProfile(entry.profile);
    restoredRows += await withProfileStore(databaseName, activeStore, (store) =>
      restoreRows(store, entry.data),
    );
  }

  await setMultiUserEnabled(backupValue.multiUserEnabled);
  await setActiveProfileId(backupValue.activeProfileId);
  await setAutoEnterProfileId(backupValue.autoEnterProfileId);

  return {
    preRestoreBackup,
    restoredRows,
    restoredProfiles: backupValue.profiles.length,
    unlockedProfiles,
  };
}

export function portableBackupFilename(
  kind: "backup" | "pre-restore",
  createdAt = new Date(),
): string {
  const timestamp = createdAt
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  return `yawf-stream-${kind}-${timestamp}.json`;
}
