// Local settings + service-construction layer.
//
// The native app keeps API keys / debrid tokens / indexer configs in GRDB +
// the keychain. That storage layer isn't ported yet, so this phase persists the
// same values to `localStorage` (clearly a stopgap — real persistence + keychain
// arrives with the storage port). Env vars (`import.meta.env.VITE_*`) provide a
// zero-config default so the app works for a screenshot without touching
// Settings; any value saved in Settings overrides the env default.
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

const STORAGE_KEY = "debridstreamer.settings.v1";

/** A user-configured external indexer (Torznab/Jackett/Prowlarr). */
export interface SourceEntry {
  id: string;
  type: IndexerType;
  baseURL: string;
  apiKey?: string | null;
  isActive: boolean;
  displayName?: string | null;
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

// ---- Service construction ---------------------------------------------------

/** The shared service instances the screens consume. Any of them may be null
 * when the corresponding key/token isn't configured. */
export interface AppServices {
  tmdb: TMDBService | null;
  omdb: OMDBService | null;
  debrid: DebridManager | null;
  indexers: IndexerManager;
  ai: AIAssistantProvider | null;
  /** Whether anything was configured (vs. the fixtures/empty fallback path). */
  hasTMDB: boolean;
  hasDebrid: boolean;
  hasIndexers: boolean;
  hasAI: boolean;
}

function buildDebridService(entry: DebridTokenEntry): DebridService | null {
  const token = entry.apiToken.trim();
  if (token.length === 0) return null;
  switch (entry.service) {
    case "real_debrid":
      return new RealDebridService(token);
    case "all_debrid":
      return new AllDebridService(token);
    case "premiumize":
      return new PremiumizeService(token);
    case "torbox":
      return new TorBoxService(token);
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
      configs.push(
        makeIndexerConfig({
          id: s.id,
          type: s.type,
          baseURL: s.baseURL.trim(),
          apiKey: s.apiKey ?? null,
          isActive: true,
          displayName: s.displayName ?? null,
          priority: i,
        }),
      );
    });
  return configs;
}

function buildAIProvider(settings: AppSettings): AIAssistantProvider | null {
  const key = settings.aiApiKey.trim();
  const model = settings.aiModel.trim();
  switch (settings.aiProvider) {
    case "openai":
      if (key.length === 0) return null;
      return model.length > 0
        ? new OpenAIProvider(key, model)
        : new OpenAIProvider(key);
    case "anthropic":
      if (key.length === 0) return null;
      return model.length > 0
        ? new AnthropicProvider(key, model)
        : new AnthropicProvider(key);
    case "ollama": {
      const endpoint = settings.ollamaEndpoint.trim();
      if (endpoint.length === 0) return null;
      return model.length > 0
        ? new OllamaProvider(endpoint, model)
        : new OllamaProvider(endpoint);
    }
  }
}

/** Build the shared service instances from the current settings. */
export function buildServices(settings: AppSettings): AppServices {
  const tmdbKey = settings.tmdbKey.trim();
  const omdbKey = settings.omdbKey.trim();

  const tmdb = tmdbKey.length > 0 ? new TMDBService(tmdbKey) : null;
  const omdb = omdbKey.length > 0 ? new OMDBService(omdbKey) : null;

  // Debrid: priority order = insertion order (entry order in settings).
  let debrid: DebridManager | null = null;
  const debridServices = settings.debridTokens
    .map(buildDebridService)
    .filter((s): s is DebridService => s !== null);
  if (debridServices.length > 0) {
    debrid = new DebridManager();
    for (const s of debridServices) debrid.addService(s);
  }

  const indexerConfigs = buildIndexerConfigs(settings);
  const indexers = new IndexerManager(indexerConfigs);

  const ai = buildAIProvider(settings);

  return {
    tmdb,
    omdb,
    debrid,
    indexers,
    ai,
    hasTMDB: tmdb !== null,
    hasDebrid: debrid !== null,
    hasIndexers: indexers.activeIndexers.length > 0,
    hasAI: ai !== null,
  };
}
