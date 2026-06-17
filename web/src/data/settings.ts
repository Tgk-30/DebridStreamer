// Local settings + service-construction layer.
//
// The native app keeps API keys / debrid tokens / indexer configs in GRDB +
// the keychain. The storage port (Phase 1.5) replaces the old localStorage
// stopgap with a real, typed, cross-platform persistence layer (IndexedDB via
// Dexie, behind the `Store` / `SecretStore` interfaces) that works in both a
// plain browser and the Tauri webview. API keys + tokens are routed through
// `SecretStore` (currently IndexedDB; an OS-keychain backend is the documented
// follow-up). Indexer + debrid configs live in their own Dexie tables.
//
// Env vars (`import.meta.env.VITE_*`) still provide a zero-config default so the
// app works for a screenshot without touching Settings; any value saved in
// Settings overrides the env default and is persisted to the Store.
//
// This module also builds the shared, READ-ONLY service instances the screens
// call: TMDBService / OMDBService / DebridManager / IndexerManager and the AI
// provider. Nothing under services/ or models/ is modified.

import { TMDBService } from "../services/metadata/TMDBService";
import { OMDBService } from "../services/metadata/OMDBService";
import { DebridManager } from "../services/debrid/DebridManager";
import type { DebridService } from "../services/debrid/types";
import type { DebridServiceType } from "../services/debrid/models";
import { RealDebridService } from "../services/debrid/RealDebridService";
import { AllDebridService } from "../services/debrid/AllDebridService";
import { PremiumizeService } from "../services/debrid/PremiumizeService";
import { TorBoxService } from "../services/debrid/TorBoxService";
import { IndexerManager } from "../services/indexers/IndexerManager";
import {
  type IndexerConfig,
  IndexerType,
  makeIndexerConfig,
} from "../services/indexers/types";
import type { AIAssistantProvider } from "../services/ai/types";
import type { AIProviderKind } from "../services/ai/models";
import { OpenAIProvider } from "../services/ai/OpenAIProvider";
import { AnthropicProvider } from "../services/ai/AnthropicProvider";
import { OllamaProvider } from "../services/ai/OllamaProvider";
import { getSecretStore, getStore } from "../storage";
import { appFetch } from "../lib/http";
import { DEFAULT_THEME_ID, resolveThemeId } from "../theme/themes";
import { OpenSubtitlesClient } from "../services/subtitles/OpenSubtitlesClient";
import {
  type IndexerConfigRecord,
  makeIndexerConfigRecord,
  type StoredIndexerType,
  type StoredProviderSubtype,
} from "../storage/models";

const STORAGE_KEY = "debridstreamer.settings.v1";

/** Settings keys persisted in the Store's key-value table (mirror the Swift
 * SettingsKeys). Secret-valued keys are persisted via `SecretStore`, with a
 * `secret:<key>` marker left in the KV table so a later sweep can find them. */
const SettingsKeys = {
  tmdbApiKey: "tmdb_api_key",
  omdbApiKey: "omdb_api_key",
  builtInIndexersEnabled: "built_in_indexers_enabled",
  aiProvider: "ai_provider",
  aiApiKey: "ai_api_key",
  aiModel: "ai_model",
  ollamaEndpoint: "ollama_endpoint",
  theme: "ui_theme",
  openSubtitlesApiKey: "opensubtitles_api_key",
} as const;

/** Marker written into the KV table for secret-valued keys; the real value
 * lives in the SecretStore under the same key. Mirrors the Swift
 * `SecretReference` "keychain:" convention. */
const SECRET_MARKER = "secret:";

/** Keys whose values are credentials and must go through `SecretStore`. */
const SECRET_KEYS = new Set<string>([
  SettingsKeys.tmdbApiKey,
  SettingsKeys.omdbApiKey,
  SettingsKeys.aiApiKey,
  SettingsKeys.openSubtitlesApiKey,
]);

/** A user-configured external indexer (Torznab/Jackett/Prowlarr/Stremio addon).
 * `type` is the storage-layer indexer type, which includes `stremio_addon`
 * (persisted faithfully even though the ported web IndexerManager cannot build
 * one yet — see buildIndexerConfigs, which skips types the web factory lacks). */
export interface SourceEntry {
  id: string;
  type: StoredIndexerType;
  baseURL: string;
  apiKey?: string | null;
  isActive: boolean;
  displayName?: string | null;
  priority?: number;
}

/** A debrid token entry. */
export interface DebridTokenEntry {
  service: DebridServiceType;
  apiToken: string;
}

/** Everything the user can configure, persisted to localStorage this phase. */
export interface AppSettings {
  tmdbKey: string;
  omdbKey: string;
  debridTokens: DebridTokenEntry[];
  sources: SourceEntry[];
  builtInIndexersEnabled: boolean;
  aiProvider: AIProviderKind;
  aiApiKey: string;
  aiModel: string;
  ollamaEndpoint: string;
  /** Selected UI theme id (see theme/themes.ts). */
  theme: string;
  /** OpenSubtitles REST API key (powers in-player subtitle search). */
  openSubtitlesApiKey: string;
}

/** Read a `VITE_*` env var without assuming `import.meta.env` exists. */
function env(key: string): string {
  const e = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const v = e?.[key];
  return v && v.trim().length > 0 ? v.trim() : "";
}

/** Defaults: pull what we can from env so the app works with zero config. */
export function defaultSettings(): AppSettings {
  return {
    tmdbKey: env("VITE_TMDB_KEY"),
    omdbKey: env("VITE_OMDB_KEY"),
    debridTokens: [],
    sources: [],
    builtInIndexersEnabled: true,
    aiProvider: "anthropic",
    aiApiKey: env("VITE_AI_KEY"),
    aiModel: "",
    ollamaEndpoint: "http://localhost:11434",
    theme: env("VITE_THEME") || DEFAULT_THEME_ID,
    openSubtitlesApiKey: env("VITE_OPENSUBTITLES_KEY"),
  };
}

/** Load persisted settings (merged over defaults). Safe in SSR/no-localStorage. */
export function loadSettings(): AppSettings {
  const base = defaultSettings();
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...base,
      ...parsed,
      // Don't let a missing array clobber the [] default.
      debridTokens: parsed.debridTokens ?? base.debridTokens,
      sources: parsed.sources ?? base.sources,
    };
  } catch {
    return base;
  }
}

/** Persist settings. No-ops without localStorage. */
export function saveSettings(settings: AppSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore (private mode / no storage).
  }
}

// ---- Store-backed settings (the storage port) -------------------------------

/** Read a setting value, transparently resolving the secret indirection: a
 * `secret:<key>` marker in the KV table means the real value is in SecretStore. */
async function getStoredValue(key: string): Promise<string | null> {
  const store = getStore();
  const raw = await store.getSetting(key);
  if (raw == null) return null;
  if (raw.startsWith(SECRET_MARKER)) {
    return getSecretStore().getSecret(raw.slice(SECRET_MARKER.length));
  }
  return raw;
}

/** Write a setting, routing credential-valued keys through SecretStore and
 * leaving a `secret:<key>` marker in the KV table. Mirrors SettingsManager. */
async function setStoredValue(key: string, value: string): Promise<void> {
  const store = getStore();
  if (SECRET_KEYS.has(key)) {
    const secrets = getSecretStore();
    if (value.trim().length > 0) {
      await secrets.setSecret(key, value);
      await store.setSetting(key, `${SECRET_MARKER}${key}`);
    } else {
      await secrets.deleteSecret(key);
      await store.setSetting(key, null);
    }
    return;
  }
  await store.setSetting(key, value);
}

/** Load settings from the Store (KV + SecretStore + the debrid/indexer config
 * tables), merged over the env-derived defaults. Falls back to the legacy
 * localStorage blob on first run (one-time migration) so an existing user's
 * config is not lost. */
export async function loadSettingsFromStore(): Promise<AppSettings> {
  const base = defaultSettings();

  // One-time migration: if the Store has nothing yet but localStorage has a
  // legacy blob, seed the Store from it so the upgrade is seamless.
  const store = getStore();
  const existingFlag = await store.getSetting("storage_port_initialized");
  if (existingFlag == null) {
    const legacy = loadSettings();
    await saveSettingsToStore(legacy);
    await store.setSetting("storage_port_initialized", "true");
    return legacy;
  }

  const [tmdbKey, omdbKey, aiApiKey, openSubtitlesApiKey] = await Promise.all([
    getStoredValue(SettingsKeys.tmdbApiKey),
    getStoredValue(SettingsKeys.omdbApiKey),
    getStoredValue(SettingsKeys.aiApiKey),
    getStoredValue(SettingsKeys.openSubtitlesApiKey),
  ]);
  const [aiProvider, aiModel, ollamaEndpoint, builtIn, theme] = await Promise.all([
    store.getSetting(SettingsKeys.aiProvider),
    store.getSetting(SettingsKeys.aiModel),
    store.getSetting(SettingsKeys.ollamaEndpoint),
    store.getSetting(SettingsKeys.builtInIndexersEnabled),
    store.getSetting(SettingsKeys.theme),
  ]);

  const debridConfigs = await store.listDebridConfigs();
  const indexerConfigs = await store.listIndexerConfigs();

  const debridTokens: DebridTokenEntry[] = [];
  for (const c of debridConfigs) {
    // The token lives in SecretStore under the config id.
    const token = (await getSecretStore().getSecret(debridSecretKey(c.id))) ?? "";
    if (token.length > 0) {
      debridTokens.push({ service: c.service, apiToken: token });
    }
  }

  const sources: SourceEntry[] = indexerConfigs
    .filter((c) => c.type !== "built_in")
    .map((c) => ({
      id: c.id,
      type: c.type,
      baseURL: c.baseURL,
      apiKey: c.apiKey,
      isActive: c.isActive,
      displayName: c.displayName,
      priority: c.priority,
    }));

  return {
    tmdbKey: tmdbKey ?? base.tmdbKey,
    omdbKey: omdbKey ?? base.omdbKey,
    debridTokens,
    sources,
    builtInIndexersEnabled: builtIn == null ? base.builtInIndexersEnabled : builtIn === "true",
    aiProvider: (aiProvider as AIProviderKind) ?? base.aiProvider,
    aiApiKey: aiApiKey ?? base.aiApiKey,
    aiModel: aiModel ?? base.aiModel,
    ollamaEndpoint: ollamaEndpoint ?? base.ollamaEndpoint,
    theme: resolveThemeId(theme ?? base.theme),
    openSubtitlesApiKey: openSubtitlesApiKey ?? base.openSubtitlesApiKey,
  };
}

/** Persist settings to the Store: scalar/secret keys to KV + SecretStore, and
 * the debrid/indexer configs to their tables (replacing the previous set so the
 * tables mirror exactly what the user configured). */
export async function saveSettingsToStore(settings: AppSettings): Promise<void> {
  const store = getStore();
  const secrets = getSecretStore();

  await Promise.all([
    setStoredValue(SettingsKeys.tmdbApiKey, settings.tmdbKey),
    setStoredValue(SettingsKeys.omdbApiKey, settings.omdbKey),
    setStoredValue(SettingsKeys.aiApiKey, settings.aiApiKey),
    setStoredValue(
      SettingsKeys.openSubtitlesApiKey,
      settings.openSubtitlesApiKey,
    ),
    store.setSetting(SettingsKeys.aiProvider, settings.aiProvider),
    store.setSetting(SettingsKeys.aiModel, settings.aiModel),
    store.setSetting(SettingsKeys.ollamaEndpoint, settings.ollamaEndpoint),
    store.setSetting(SettingsKeys.theme, resolveThemeId(settings.theme)),
    store.setSetting(
      SettingsKeys.builtInIndexersEnabled,
      settings.builtInIndexersEnabled ? "true" : "false",
    ),
  ]);

  // Debrid configs: reconcile the table to the current token set. Tokens go in
  // SecretStore under `debrid.<id>`; the config row carries a secret marker.
  const existingDebrid = await store.listDebridConfigs();
  const keptDebridIds = new Set<string>();
  let priority = 0;
  for (const entry of settings.debridTokens) {
    if (entry.apiToken.trim().length === 0) continue;
    // Stable id per service so re-saving updates rather than duplicates.
    const id = `debrid-${entry.service}`;
    keptDebridIds.add(id);
    await secrets.setSecret(debridSecretKey(id), entry.apiToken);
    await store.saveDebridConfig({
      id,
      service: entry.service,
      apiToken: `${SECRET_MARKER}${debridSecretKey(id)}`,
      isActive: true,
      priority: priority++,
    });
  }
  for (const c of existingDebrid) {
    if (!keptDebridIds.has(c.id)) {
      await secrets.deleteSecret(debridSecretKey(c.id));
      await store.deleteDebridConfig(c.id);
    }
  }

  // Indexer configs: reconcile to the current sources list (preserve order as
  // priority). A `built_in` row is written only to DISABLE the scrapers.
  const existingIndexers = await store.listIndexerConfigs();
  const keptIndexerIds = new Set<string>();
  // Await each write (not fire-and-forget): saveSettingsToStore() must not
  // resolve until the indexer rows are actually persisted, or a reload/app quit
  // immediately after Save could lose newly-added or edited sources.
  for (const [i, s] of settings.sources.entries()) {
    keptIndexerIds.add(s.id);
    const record: IndexerConfigRecord = makeIndexerConfigRecord({
      id: s.id,
      type: s.type,
      baseURL: s.baseURL,
      apiKey: s.apiKey ?? null,
      isActive: s.isActive,
      displayName: s.displayName ?? null,
      providerSubtype: providerSubtypeFor(s.type),
      priority: s.priority ?? i,
    });
    await store.saveIndexerConfig(record);
  }
  if (!settings.builtInIndexersEnabled) {
    keptIndexerIds.add("built-in");
    await store.saveIndexerConfig(
      makeIndexerConfigRecord({
        id: "built-in",
        type: "built_in",
        baseURL: "",
        isActive: false,
      }),
    );
  }
  for (const c of existingIndexers) {
    if (!keptIndexerIds.has(c.id)) {
      await store.deleteIndexerConfig(c.id);
    }
  }

  // Keep the legacy localStorage blob in sync as a belt-and-suspenders cache so
  // the synchronous bootstrap render has a recent snapshot before hydration.
  saveSettings(settings);
}

/** The SecretStore key a debrid config's token is stored under (mirrors the
 * Swift `SecretKey.debridToken`). */
function debridSecretKey(configId: string): string {
  return `debrid.${configId}`;
}

/** Best-effort providerSubtype for a stored type (the stremio subtype has no
 * web factory yet but is persisted faithfully). */
function providerSubtypeFor(type: StoredIndexerType): StoredProviderSubtype {
  switch (type) {
    case "jackett":
      return "jackett";
    case "prowlarr":
      return "prowlarr";
    case "stremio_addon":
      return "stremio_addon";
    case "built_in":
      return "built_in";
    case "torznab":
    case "zilean":
      return "custom_torznab";
  }
}

// ---- Service construction ---------------------------------------------------

/** The shared service instances the screens consume. Any of them may be null
 * when the corresponding key/token isn't configured. */
export interface AppServices {
  tmdb: TMDBService | null;
  omdb: OMDBService | null;
  debrid: DebridManager | null;
  indexers: IndexerManager;
  ai: AIAssistantProvider | null;
  /** OpenSubtitles client when a key is configured, else null. */
  subtitles: OpenSubtitlesClient | null;
  /** Whether anything was configured (vs. the fixtures/empty fallback path). */
  hasTMDB: boolean;
  hasDebrid: boolean;
  hasIndexers: boolean;
  hasAI: boolean;
  hasSubtitles: boolean;
}

/** Module-level cache for the built DebridManager, keyed by a signature of the
 * debrid config (service types + tokens). The manager's identity must stay
 * stable across UNRELATED settings edits (e.g. the instant theme save) so that
 * useDebridLibrary's effect — which depends on `services.debrid` identity —
 * doesn't re-fetch the whole account on every save. Only when the debrid config
 * actually changes do we rebuild. */
let debridManagerCache: { signature: string; manager: DebridManager } | null =
  null;

/** A stable signature for the debrid config: the (service, token) pairs in
 * order. Identical config → identical signature → cached manager reused. */
function debridConfigSignature(tokens: DebridTokenEntry[]): string {
  return JSON.stringify(
    tokens
      .map((t) => [t.service, t.apiToken.trim()] as const)
      .filter(([, token]) => token.length > 0),
  );
}

/** Build (or reuse the cached) DebridManager for the current settings. Returns
 * null when no valid debrid service is configured. The returned manager keeps a
 * stable identity while the debrid config is unchanged. */
function getOrBuildDebridManager(settings: AppSettings): DebridManager | null {
  const signature = debridConfigSignature(settings.debridTokens);
  const services = settings.debridTokens
    .map(buildDebridService)
    .filter((s): s is DebridService => s !== null);
  if (services.length === 0) {
    debridManagerCache = null;
    return null;
  }
  if (debridManagerCache != null && debridManagerCache.signature === signature) {
    return debridManagerCache.manager;
  }
  const manager = new DebridManager();
  for (const s of services) manager.addService(s);
  debridManagerCache = { signature, manager };
  return manager;
}

/** Real delay for the debrid retry/poll loops. The services default their
 *  `sleep` to a test no-op; in production we MUST pass a real timer or uncached
 *  transfers and 5xx-retry backoffs spin with zero wait — hammering the service
 *  and failing/rate-limiting instead of waiting for the torrent to cache. */
const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function buildDebridService(entry: DebridTokenEntry): DebridService | null {
  const token = entry.apiToken.trim();
  if (token.length === 0) return null;
  // Route through `appFetch` so debrid hosts (CORS-blocked in a plain browser)
  // work in the Tauri desktop app; it degrades to the global fetch in a browser.
  // `realSleep` makes the retry/poll backoffs actually wait in production.
  switch (entry.service) {
    case "real_debrid":
      return new RealDebridService(token, appFetch, realSleep);
    case "all_debrid":
      return new AllDebridService(token, appFetch, realSleep);
    case "premiumize":
      return new PremiumizeService(token, appFetch, realSleep);
    case "torbox":
      return new TorBoxService(token, appFetch, realSleep);
  }
}

function buildIndexerConfigs(settings: AppSettings): IndexerConfig[] {
  const configs: IndexerConfig[] = [];
  // A built_in config is only needed to DISABLE the scrapers; the factory
  // enables them by default when absent.
  if (!settings.builtInIndexersEnabled) {
    configs.push(
      makeIndexerConfig({
        id: "built-in",
        type: IndexerType.builtIn,
        baseURL: "",
        isActive: false,
      }),
    );
  }
  settings.sources
    .filter((s) => s.isActive && s.baseURL.trim().length > 0)
    .forEach((s, i) => {
      // The ported web IndexerManager/factory build the Torznab family
      // (jackett/prowlarr/torznab/zilean) plus `stremio_addon` (now that the
      // StremioAddonIndexer is ported). `built_in` is handled above via the
      // scrapers toggle; any other type gates gracefully (skipped here).
      if (!WEB_BUILDABLE_INDEXER_TYPES.has(s.type)) return;
      configs.push(
        makeIndexerConfig({
          id: s.id,
          type: s.type as IndexerType,
          baseURL: s.baseURL.trim(),
          apiKey: s.apiKey ?? null,
          isActive: true,
          displayName: s.displayName ?? null,
          priority: s.priority ?? i,
        }),
      );
    });
  return configs;
}

/** The indexer types the ported web factory can actually construct. */
const WEB_BUILDABLE_INDEXER_TYPES = new Set<StoredIndexerType>([
  "jackett",
  "prowlarr",
  "torznab",
  "zilean",
  "stremio_addon",
]);

function buildAIProvider(settings: AppSettings): AIAssistantProvider | null {
  const key = settings.aiApiKey.trim();
  const model = settings.aiModel.trim();
  // Pass `undefined` for the model when none is configured so the provider's own
  // default model parameter applies; `appFetch` is threaded either way so AI
  // hosts work in the desktop app (degrades to global fetch in a browser).
  const modelArg = model.length > 0 ? model : undefined;
  switch (settings.aiProvider) {
    case "openai":
      if (key.length === 0) return null;
      return new OpenAIProvider(key, modelArg, appFetch);
    case "anthropic":
      if (key.length === 0) return null;
      return new AnthropicProvider(key, modelArg, appFetch);
    case "ollama": {
      const endpoint = settings.ollamaEndpoint.trim();
      if (endpoint.length === 0) return null;
      return new OllamaProvider(endpoint, modelArg, appFetch);
    }
  }
}

/** Build-time TMDB key fallback (VITE_TMDB_KEY), read defensively. Lets the
 *  catalog light up in dev/screenshot builds before any key is saved. */
function readEnvTmdbKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const key = env?.VITE_TMDB_KEY;
  return key && key.trim().length > 0 ? key.trim() : "";
}

/** Build the shared service instances from the current settings. */
export function buildServices(settings: AppSettings): AppServices {
  const tmdbKey = settings.tmdbKey.trim();
  const omdbKey = settings.omdbKey.trim();

  // Prefer the user's saved TMDB key; fall back to a build-time VITE_TMDB_KEY.
  // Driving `services.tmdb` (used by Search/Browse AND now Discover) from this
  // single source means saving a key in Settings lights up every screen — not
  // just Search/Browse — without a reload.
  const effectiveTmdbKey = tmdbKey.length > 0 ? tmdbKey : readEnvTmdbKey();
  const tmdb = effectiveTmdbKey.length > 0 ? new TMDBService(effectiveTmdbKey) : null;
  const omdb = omdbKey.length > 0 ? new OMDBService(omdbKey) : null;

  // Debrid: priority order = insertion order (entry order in settings). The
  // manager is cached by config signature so its identity is stable across
  // unrelated settings edits (avoids re-fetching the whole account on, e.g., a
  // theme save) — only rebuilt when the debrid config actually changes.
  const debrid = getOrBuildDebridManager(settings);

  const indexerConfigs = buildIndexerConfigs(settings);
  // `appFetch` is CORS-free under Tauri (routes indexer/addon hosts through Rust)
  // and degrades to the global fetch in a plain browser. The new Stremio addon
  // indexer is built by the factory like the rest, so it inherits this too.
  const indexers = new IndexerManager(indexerConfigs, appFetch);

  const ai = buildAIProvider(settings);

  // OpenSubtitles client when a key is configured. Routes through `appFetch` so
  // it works CORS-free under Tauri (rest.opensubtitles.com blocks browser CORS).
  const osKey = settings.openSubtitlesApiKey.trim();
  const subtitles = osKey.length > 0 ? new OpenSubtitlesClient(osKey, appFetch) : null;

  return {
    tmdb,
    omdb,
    debrid,
    indexers,
    ai,
    subtitles,
    hasTMDB: tmdb !== null,
    hasDebrid: debrid !== null,
    hasIndexers: indexers.activeIndexers.length > 0,
    hasAI: ai !== null,
    hasSubtitles: subtitles !== null,
  };
}
