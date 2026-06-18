import { DebridManager } from "../../web/src/services/debrid/DebridManager.ts";
import { AllDebridService } from "../../web/src/services/debrid/AllDebridService.ts";
import { PremiumizeService } from "../../web/src/services/debrid/PremiumizeService.ts";
import { RealDebridService } from "../../web/src/services/debrid/RealDebridService.ts";
import { TorBoxService } from "../../web/src/services/debrid/TorBoxService.ts";
import { CacheStatus } from "../../web/src/services/debrid/models.ts";
import { IndexerManager } from "../../web/src/services/indexers/IndexerManager.ts";
import { IndexerType, makeIndexerConfig } from "../../web/src/services/indexers/types.ts";
import { decryptSecret } from "./crypto.js";

const BUILT_IN_INDEXERS_ENABLED_KEY = "built_in_indexers_enabled";
export const SERVER_INDEXER_CONFIGS_KEY = "server_indexer_configs";
const STREAM_CACHED_ONLY_KEY = "stream_cached_only";
const STREAM_MAX_QUALITY_KEY = "stream_max_quality";
const STREAM_MAX_SIZE_GB_KEY = "stream_max_size_gb";

const DEBRID_PROVIDERS = [
  "real_debrid",
  "all_debrid",
  "premiumize",
  "torbox",
];

const BUILDABLE_INDEXER_TYPES = new Set([
  "jackett",
  "prowlarr",
  "torznab",
  "zilean",
  "stremio_addon",
]);

const serverFetch = (url, init) => fetch(url, init);

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function settingValue(db, profileId, key) {
  const row = db.sqlite
    .prepare(
      `SELECT value
       FROM profile_settings
       WHERE profile_id = ? AND key = ?
       LIMIT 1`,
    )
    .get(profileId, key);
  return row?.value ?? null;
}

const QUALITY_ORDER = {
  Unknown: 0,
  SD: 1,
  "480p": 2,
  "720p": 3,
  "1080p": 4,
  "4K": 5,
};

function normalizeMaxQuality(value) {
  return Object.prototype.hasOwnProperty.call(QUALITY_ORDER, value) ? value : "any";
}

function profileStreamFilters(db, profileId) {
  const cachedOnly = settingValue(db, profileId, STREAM_CACHED_ONLY_KEY) === "true";
  const maxQuality = normalizeMaxQuality(settingValue(db, profileId, STREAM_MAX_QUALITY_KEY));
  const rawMaxSize = Number(settingValue(db, profileId, STREAM_MAX_SIZE_GB_KEY));
  const maxSizeGB = Number.isFinite(rawMaxSize) && rawMaxSize > 0 ? rawMaxSize : 0;
  return { cachedOnly, maxQuality, maxSizeGB };
}

function rowMatchesStreamFilters(row, filters) {
  if (filters.cachedOnly && row.cachedOn == null) return false;
  if (filters.maxQuality !== "any") {
    const quality = row.result?.quality;
    const order = QUALITY_ORDER[quality] ?? 0;
    const maxOrder = QUALITY_ORDER[filters.maxQuality] ?? 0;
    if (order > maxOrder) return false;
  }
  if (filters.maxSizeGB > 0) {
    const sizeBytes = Number(row.result?.sizeBytes ?? 0);
    if (Number.isFinite(sizeBytes) && sizeBytes > filters.maxSizeGB * 1024 * 1024 * 1024) {
      return false;
    }
  }
  return true;
}

function providerSubtypeFor(type, raw) {
  if (typeof raw === "string" && raw.length > 0) return raw;
  return IndexerType.defaultProviderSubtype(type);
}

function parseIndexerConfigs(raw) {
  if (raw == null || raw.trim().length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const configs = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;
    const type = typeof item.type === "string" ? item.type : "";
    const baseURL = typeof item.baseURL === "string" ? item.baseURL.trim() : "";
    if (!BUILDABLE_INDEXER_TYPES.has(type) || baseURL.length === 0) continue;
    configs.push(
      makeIndexerConfig({
        id: typeof item.id === "string" ? item.id : `src-${configs.length}`,
        type,
        baseURL,
        apiKey: typeof item.apiKey === "string" ? item.apiKey : null,
        isActive: item.isActive !== false,
        displayName:
          typeof item.displayName === "string" ? item.displayName : null,
        providerSubtype: providerSubtypeFor(type, item.providerSubtype),
        endpointPath:
          typeof item.endpointPath === "string" ? item.endpointPath : null,
        categoryFilter:
          typeof item.categoryFilter === "string" ? item.categoryFilter : null,
        priority:
          typeof item.priority === "number" && Number.isFinite(item.priority)
            ? item.priority
            : configs.length,
      }),
    );
  }
  return configs;
}

function buildIndexerManager(db, profileId) {
  const configs = [];
  const builtIn = settingValue(db, profileId, BUILT_IN_INDEXERS_ENABLED_KEY);
  if (builtIn === "false") {
    configs.push(
      makeIndexerConfig({
        id: "built-in",
        type: IndexerType.builtIn,
        baseURL: "",
        isActive: false,
      }),
    );
  }
  configs.push(
    ...parseIndexerConfigs(
      settingValue(db, profileId, SERVER_INDEXER_CONFIGS_KEY),
    ),
  );
  return new IndexerManager(configs, serverFetch);
}

function selectedCredential(db, config, profileId, provider) {
  const row = db.sqlite
    .prepare(
      `SELECT provider, priority, updated_at, encrypted_value
       FROM credential_secrets
       WHERE provider = ?
         AND is_active = 1
         AND (
           (scope = 'profile' AND profile_id = ?)
           OR scope = 'server'
         )
       ORDER BY
         CASE WHEN scope = 'profile' THEN 0 ELSE 1 END,
         priority ASC,
         updated_at DESC
       LIMIT 1`,
    )
    .get(provider, profileId);
  if (row == null) return null;
  try {
    return {
      provider,
      priority: row.priority,
      updatedAt: row.updated_at,
      value: decryptSecret(row.encrypted_value, config.secretKey),
    };
  } catch {
    return null;
  }
}

function buildDebridService(provider, token) {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  switch (provider) {
    case "real_debrid":
      return new RealDebridService(trimmed, serverFetch, realSleep);
    case "all_debrid":
      return new AllDebridService(trimmed, serverFetch, realSleep);
    case "premiumize":
      return new PremiumizeService(trimmed, serverFetch, realSleep);
    case "torbox":
      return new TorBoxService(trimmed, serverFetch, realSleep);
    default:
      return null;
  }
}

export function buildDebridManager(db, config, profileId) {
  const selected = DEBRID_PROVIDERS.map((provider, index) => ({
    index,
    credential: selectedCredential(db, config, profileId, provider),
  }))
    .filter((entry) => entry.credential != null)
    .sort((a, b) => {
      if (a.credential.priority !== b.credential.priority) {
        return a.credential.priority - b.credential.priority;
      }
      return a.index - b.index;
    });

  const manager = new DebridManager();
  const activeServices = [];
  for (const entry of selected) {
    const service = buildDebridService(
      entry.credential.provider,
      entry.credential.value,
    );
    if (service == null) continue;
    manager.addService(service);
    activeServices.push(entry.credential.provider);
  }
  return {
    manager: manager.hasServices ? manager : null,
    activeServices,
  };
}

export async function searchServerStreams(db, config, profileId, input) {
  const indexers = buildIndexerManager(db, profileId);
  const { manager: debrid, activeServices } = buildDebridManager(
    db,
    config,
    profileId,
  );
  const activeIndexers = indexers.activeIndexers;
  if (activeIndexers.length === 0) {
    return {
      rows: [],
      hasIndexers: false,
      hasDebrid: debrid != null,
      activeIndexers,
      activeDebridServices: activeServices,
      indexerErrors: [],
    };
  }

  const results = await indexers.searchAll(
    input.imdbId,
    input.type,
    input.season ?? null,
    input.episode ?? null,
  );

  let cacheByHash = {};
  if (debrid != null) {
    try {
      const merged = await debrid.checkCacheAll(results.map((r) => r.infoHash));
      cacheByHash = Object.fromEntries(
        Object.entries(merged)
          .filter(([, entry]) => CacheStatus.isCached(entry.status))
          .map(([hash, entry]) => [hash, entry.service]),
      );
    } catch {
      cacheByHash = {};
    }
  }

  const filters = profileStreamFilters(db, profileId);
  const allRows = results.map((result) => ({
    result,
    cachedOn: cacheByHash[result.infoHash] ?? null,
  }));
  const rows = allRows.filter((row) => rowMatchesStreamFilters(row, filters));

  return {
    rows,
    hasIndexers: activeIndexers.length > 0,
    hasDebrid: debrid != null,
    activeIndexers,
    activeDebridServices: activeServices,
    indexerErrors: indexers.lastSearchErrors,
  };
}

export async function resolveServerStream(db, config, profileId, input) {
  const { manager } = buildDebridManager(db, config, profileId);
  if (manager == null) {
    throw Object.assign(new Error("Configure a debrid service to play."), {
      statusCode: 400,
    });
  }
  return manager.resolveStream(input.infoHash, input.preferredService ?? null);
}
