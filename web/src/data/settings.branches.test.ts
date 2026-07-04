// @vitest-environment jsdom
//
// Branch-coverage companion to settings.test.ts. Targets the lines the first
// suite leaves uncovered: the appearance/* "valid value" normalizer arms (via
// loadSettingsFromStore), the subtitle min-clamp arms, the
// saveSettingsToStore debrid/indexer reconcile *update* + *built-in disable*
// paths, and the pure-testable buildServices() construction matrix (Local vs
// Server mode, every AI/debrid/subtitle branch). All real service classes are
// pure constructors (they only stash args), so buildServices is exercised
// without mocking services — only the storage port and isServerMode are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- In-memory storage port (mirrors settings.test.ts) ----------------------

interface DebridConfigRow {
  id: string;
  service: string;
  apiToken: string;
  isActive: boolean;
  priority: number;
}
interface IndexerConfigRow {
  id: string;
  type: string;
  baseURL: string;
  apiKey: string | null;
  isActive: boolean;
  displayName: string | null;
  providerSubtype: string;
  endpointPath: string;
  categoryFilter: string | null;
  priority: number;
}

const settingsMap = new Map<string, string>();
const secretMap = new Map<string, string>();
let debridConfigs: DebridConfigRow[] = [];
let indexerConfigs: IndexerConfigRow[] = [];

const fakeStore = {
  getSetting: vi.fn(async (key: string) => settingsMap.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string | null) => {
    if (value == null) settingsMap.delete(key);
    else settingsMap.set(key, value);
  }),
  allSettings: vi.fn(async () => Object.fromEntries(settingsMap)),
  listDebridConfigs: vi.fn(async () => debridConfigs.map((c) => ({ ...c }))),
  saveDebridConfig: vi.fn(async (c: DebridConfigRow) => {
    const i = debridConfigs.findIndex((x) => x.id === c.id);
    if (i >= 0) debridConfigs[i] = { ...c };
    else debridConfigs.push({ ...c });
  }),
  deleteDebridConfig: vi.fn(async (id: string) => {
    debridConfigs = debridConfigs.filter((c) => c.id !== id);
  }),
  listIndexerConfigs: vi.fn(async () => indexerConfigs.map((c) => ({ ...c }))),
  saveIndexerConfig: vi.fn(async (c: IndexerConfigRow) => {
    const i = indexerConfigs.findIndex((x) => x.id === c.id);
    if (i >= 0) indexerConfigs[i] = { ...c };
    else indexerConfigs.push({ ...c });
  }),
  deleteIndexerConfig: vi.fn(async (id: string) => {
    indexerConfigs = indexerConfigs.filter((c) => c.id !== id);
  }),
};

const fakeSecrets = {
  getSecret: vi.fn(async (key: string) => secretMap.get(key) ?? null),
  setSecret: vi.fn(async (key: string, value: string) => {
    secretMap.set(key, value);
  }),
  deleteSecret: vi.fn(async (key: string) => {
    secretMap.delete(key);
  }),
};

vi.mock("../storage", () => ({
  getStore: () => fakeStore,
  getSecretStore: () => fakeSecrets,
}));

// isServerMode is read by buildServices; mock it so we can drive both modes.
const isServerModeMock = vi.fn(() => false);
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerModeMock(),
}));

// ---- Import under test (after mocks) ----------------------------------------

import {
  applyDesignRefresh,
  defaultSettings,
  loadSettingsFromStore,
  saveSettingsToStore,
  buildServices,
  type AppSettings,
} from "./settings";

function resetStorageState(): void {
  settingsMap.clear();
  secretMap.clear();
  debridConfigs = [];
  indexerConfigs = [];
}

function settingsWith(overrides: Partial<AppSettings>): AppSettings {
  return { ...defaultSettings(), ...overrides };
}

beforeEach(() => {
  resetStorageState();
  vi.clearAllMocks();
  isServerModeMock.mockReturnValue(false);
  // No localStorage side effects for these tests.
  vi.stubGlobal("localStorage", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// loadSettingsFromStore — the "valid value" arm of every appearance normalizer
// (settings.test.ts only exercises the invalid->default arms via the store).
// =============================================================================

describe("loadSettingsFromStore — appearance normalizers keep valid stored values", () => {
  beforeEach(() => {
    settingsMap.set("storage_port_initialized", "true");
  });

  it("passes through every non-default appearance enum value verbatim", async () => {
    settingsMap.set("appearance_accent", "amber");
    settingsMap.set("appearance_density", "compact");
    settingsMap.set("appearance_text_size", "xl");
    settingsMap.set("appearance_motion", "reduced");
    settingsMap.set("appearance_radius", "round");
    settingsMap.set("appearance_blur", "10");
    settingsMap.set("appearance_chrome", "translucent");
    settingsMap.set("appearance_backdrop", "subtle");
    settingsMap.set("appearance_hero_scale", "cinematic");
    settingsMap.set("appearance_panel_contrast", "high");
    settingsMap.set("appearance_nav_labels", "icons");
    settingsMap.set("appearance_nav_tint", "airy");
    settingsMap.set("appearance_poster_size", "large");

    const s = await loadSettingsFromStore();

    expect(s.appearanceAccent).toBe("amber");
    expect(s.appearanceDensity).toBe("compact");
    expect(s.appearanceTextSize).toBe("xl");
    expect(s.appearanceMotion).toBe("reduced");
    expect(s.appearanceRadius).toBe("round");
    expect(s.appearanceBlur).toBe(10);
    expect(s.appearanceChrome).toBe("translucent");
    expect(s.appearanceBackdrop).toBe("subtle");
    expect(s.appearanceHeroScale).toBe("cinematic");
    expect(s.appearancePanelContrast).toBe("high");
    expect(s.appearanceNavLabels).toBe("icons");
    expect(s.appearanceNavTint).toBe("airy");
    expect(s.appearancePosterSize).toBe("large");
  });

  it("covers the second valid arm of each multi-value normalizer", async () => {
    // The first arm (e.g. "translucent") and the default are covered elsewhere;
    // hit the OTHER explicit value (e.g. "solid") of each ternary.
    settingsMap.set("appearance_accent", "green");
    settingsMap.set("appearance_text_size", "s");
    settingsMap.set("appearance_motion", "normal");
    settingsMap.set("appearance_radius", "sharp");
    settingsMap.set("appearance_chrome", "solid");
    settingsMap.set("appearance_backdrop", "plain");
    settingsMap.set("appearance_hero_scale", "compact");
    settingsMap.set("appearance_panel_contrast", "soft");
    settingsMap.set("appearance_nav_labels", "labels");
    settingsMap.set("appearance_nav_tint", "solid");
    settingsMap.set("appearance_poster_size", "compact");

    const s = await loadSettingsFromStore();

    expect(s.appearanceAccent).toBe("green");
    expect(s.appearanceTextSize).toBe("s");
    expect(s.appearanceMotion).toBe("normal");
    expect(s.appearanceRadius).toBe("sharp");
    expect(s.appearanceChrome).toBe("solid");
    expect(s.appearanceBackdrop).toBe("plain");
    expect(s.appearanceHeroScale).toBe("compact");
    expect(s.appearancePanelContrast).toBe("soft");
    expect(s.appearanceNavLabels).toBe("labels");
    expect(s.appearanceNavTint).toBe("solid");
    expect(s.appearancePosterSize).toBe("compact");
  });

  it("clamps subtitle scale/opacity at their LOWER bounds", async () => {
    // settings.test.ts hits the upper clamps; cover the Math.max (lower) arms.
    settingsMap.set("subtitle_font_scale", "0.1"); // -> 0.7 floor
    settingsMap.set("subtitle_bg_opacity", "-2"); // -> 0 floor
    const s = await loadSettingsFromStore();
    expect(s.subtitleFontScale).toBe(0.7);
    expect(s.subtitleBgOpacity).toBe(0);
  });

  it("falls back to defaults when subtitle values are non-finite strings", async () => {
    settingsMap.set("subtitle_font_scale", "abc"); // toFiniteNumber -> null
    settingsMap.set("subtitle_bg_opacity", "xyz");
    const s = await loadSettingsFromStore();
    expect(s.subtitleFontScale).toBe(1);
    expect(s.subtitleBgOpacity).toBe(0.55);
  });
});

// =============================================================================
// saveSettingsToStore — reconcile branches not covered by settings.test.ts:
// UPDATE-in-place of an existing debrid row, and the built-in disable row
// removal sweep (kept vs removed).
// =============================================================================

describe("saveSettingsToStore — debrid reconcile update path", () => {
  it("UPDATES an existing debrid row in place rather than duplicating it", async () => {
    // A row for the SAME stable id already exists (id = debrid-<service>).
    debridConfigs = [
      {
        id: "debrid-real_debrid",
        service: "real_debrid",
        apiToken: "secret:debrid.debrid-real_debrid",
        isActive: true,
        priority: 5,
      },
    ];
    secretMap.set("debrid.debrid-real_debrid", "old-token");

    await saveSettingsToStore(
      settingsWith({
        debridTokens: [{ service: "real_debrid", apiToken: "new-token" }],
      }),
    );

    // Still exactly one row (updated, not appended), priority reset to 0.
    expect(debridConfigs).toHaveLength(1);
    expect(debridConfigs[0].id).toBe("debrid-real_debrid");
    expect(debridConfigs[0].priority).toBe(0);
    expect(secretMap.get("debrid.debrid-real_debrid")).toBe("new-token");
  });

  it("assigns ascending priorities across multiple kept debrid tokens", async () => {
    await saveSettingsToStore(
      settingsWith({
        debridTokens: [
          { service: "real_debrid", apiToken: "a" },
          { service: "all_debrid", apiToken: "b" },
          { service: "premiumize", apiToken: "" }, // blank -> skipped, no slot
          { service: "torbox", apiToken: "c" },
        ],
      }),
    );
    const byId = Object.fromEntries(debridConfigs.map((c) => [c.id, c.priority]));
    expect(byId["debrid-real_debrid"]).toBe(0);
    expect(byId["debrid-all_debrid"]).toBe(1);
    expect(byId["debrid-torbox"]).toBe(2); // blank one did not consume a priority
    expect(byId["debrid-premiumize"]).toBeUndefined();
  });
});

describe("saveSettingsToStore — built-in indexer disable row reconcile", () => {
  it("removes a previously-written built-in disable row when scrapers are re-enabled", async () => {
    // A leftover disable row from a prior save where built-ins were OFF.
    indexerConfigs = [
      {
        id: "built-in",
        type: "built_in",
        baseURL: "",
        apiKey: null,
        isActive: false,
        displayName: null,
        providerSubtype: "built_in",
        endpointPath: "",
        categoryFilter: null,
        priority: 0,
      },
    ];
    await saveSettingsToStore(settingsWith({ builtInIndexersEnabled: true }));
    // Re-enabling built-ins drops the disable row (not in keptIndexerIds).
    expect(indexerConfigs.find((c) => c.id === "built-in")).toBeUndefined();
  });

  it("keeps the built-in disable row across a save when scrapers stay disabled", async () => {
    indexerConfigs = [
      {
        id: "built-in",
        type: "built_in",
        baseURL: "",
        apiKey: null,
        isActive: false,
        displayName: null,
        providerSubtype: "built_in",
        endpointPath: "",
        categoryFilter: null,
        priority: 0,
      },
    ];
    await saveSettingsToStore(settingsWith({ builtInIndexersEnabled: false }));
    const builtIn = indexerConfigs.find((c) => c.id === "built-in");
    expect(builtIn).toBeDefined();
    expect(builtIn!.isActive).toBe(false);
  });

  it("UPDATES an existing indexer source row in place (same id)", async () => {
    indexerConfigs = [
      {
        id: "src1",
        type: "torznab",
        baseURL: "http://old",
        apiKey: null,
        isActive: true,
        displayName: null,
        providerSubtype: "custom_torznab",
        endpointPath: "/api",
        categoryFilter: null,
        priority: 0,
      },
    ];
    await saveSettingsToStore(
      settingsWith({
        sources: [
          {
            id: "src1",
            type: "torznab",
            baseURL: "http://new",
            isActive: true,
          },
        ],
      }),
    );
    const rows = indexerConfigs.filter((c) => c.id === "src1");
    expect(rows).toHaveLength(1); // updated, not duplicated
    expect(rows[0].baseURL).toBe("http://new");
  });

  it("persists a stremio_addon source with its providerSubtype", async () => {
    await saveSettingsToStore(
      settingsWith({
        sources: [
          { id: "st", type: "stremio_addon", baseURL: "http://addon", isActive: true },
        ],
      }),
    );
    const row = indexerConfigs.find((c) => c.id === "st")!;
    expect(row.providerSubtype).toBe("stremio_addon");
  });

  it("maps zilean sources to the custom_torznab providerSubtype", async () => {
    await saveSettingsToStore(
      settingsWith({
        sources: [
          { id: "z", type: "zilean", baseURL: "http://z", isActive: true },
        ],
      }),
    );
    const row = indexerConfigs.find((c) => c.id === "z")!;
    expect(row.providerSubtype).toBe("custom_torznab");
  });
});

// =============================================================================
// buildServices — pure construction matrix. Real service classes only stash
// their args, so no service mocks are needed; only isServerMode is mocked.
// =============================================================================

describe("buildServices — Local Mode", () => {
  it("builds nothing when no keys/tokens are configured", () => {
    const svc = buildServices(
      settingsWith({
        tmdbKey: "",
        omdbKey: "",
        aiApiKey: "",
        openSubtitlesApiKey: "",
        debridTokens: [],
        sources: [],
        builtInIndexersEnabled: true,
      }),
    );
    expect(svc.tmdb).toBeNull();
    expect(svc.hasTMDB).toBe(false);
    expect(svc.debrid).toBeNull();
    expect(svc.hasDebrid).toBe(false);
    expect(svc.ai).toBeNull();
    expect(svc.hasAI).toBe(false);
    expect(svc.subtitles).toBeNull();
    expect(svc.hasSubtitles).toBe(false);
    // IndexerManager is always constructed (built-ins enabled => active).
    expect(svc.indexers).not.toBeNull();
    expect(svc.hasIndexers).toBe(true);
  });

  it("builds a TMDBService from the saved key and reuses it for the same key", () => {
    const a = buildServices(settingsWith({ tmdbKey: "TKEY" }));
    expect(a.tmdb).not.toBeNull();
    expect(a.hasTMDB).toBe(true);
    // Same key on a later (unrelated) save returns the SAME cached instance.
    const b = buildServices(settingsWith({ tmdbKey: "TKEY", simpleMode: false }));
    expect(b.tmdb).toBe(a.tmdb);
    // A different key forces a rebuild (new identity).
    const c = buildServices(settingsWith({ tmdbKey: "OTHER" }));
    expect(c.tmdb).not.toBe(a.tmdb);
  });

  it("clears the cached TMDBService when the key is emptied", () => {
    buildServices(settingsWith({ tmdbKey: "TKEY" }));
    const cleared = buildServices(settingsWith({ tmdbKey: "" }));
    expect(cleared.tmdb).toBeNull();
  });

  it("builds an OMDBService from a user-provided key in Local Mode", () => {
    const svc = buildServices(settingsWith({ omdbKey: "OMDB_BYOK" }));
    expect(svc.omdb).not.toBeNull();
  });

  it("builds a DebridManager and caches it by config signature", () => {
    const a = buildServices(
      settingsWith({ debridTokens: [{ service: "real_debrid", apiToken: "rd" }] }),
    );
    expect(a.debrid).not.toBeNull();
    expect(a.hasDebrid).toBe(true);
    // Identical token set -> same cached manager.
    const b = buildServices(
      settingsWith({
        debridTokens: [{ service: "real_debrid", apiToken: "rd" }],
        simpleMode: false,
      }),
    );
    expect(b.debrid).toBe(a.debrid);
    // Changed token set -> rebuilt manager.
    const c = buildServices(
      settingsWith({ debridTokens: [{ service: "real_debrid", apiToken: "CHANGED" }] }),
    );
    expect(c.debrid).not.toBe(a.debrid);
  });

  it("returns a null DebridManager and clears the cache when all tokens are blank", () => {
    buildServices(
      settingsWith({ debridTokens: [{ service: "real_debrid", apiToken: "rd" }] }),
    );
    const svc = buildServices(
      settingsWith({ debridTokens: [{ service: "real_debrid", apiToken: "  " }] }),
    );
    expect(svc.debrid).toBeNull();
    expect(svc.hasDebrid).toBe(false);
  });

  it("constructs every debrid service variant", () => {
    const svc = buildServices(
      settingsWith({
        debridTokens: [
          { service: "real_debrid", apiToken: "a" },
          { service: "all_debrid", apiToken: "b" },
          { service: "premiumize", apiToken: "c" },
          { service: "torbox", apiToken: "d" },
        ],
      }),
    );
    expect(svc.debrid).not.toBeNull();
  });

  it("builds the OpenAI AI provider when a key is set", () => {
    const svc = buildServices(
      settingsWith({ aiProvider: "openai", aiApiKey: "k", aiModel: "gpt-4o" }),
    );
    expect(svc.ai).not.toBeNull();
    expect(svc.hasAI).toBe(true);
    // ai != null -> a local SubtitleTranslator is also built.
    expect(svc.translator).not.toBeNull();
  });

  it("builds the Anthropic AI provider (default) when a key is set", () => {
    const svc = buildServices(
      settingsWith({ aiProvider: "anthropic", aiApiKey: "k" }),
    );
    expect(svc.ai).not.toBeNull();
  });

  it("returns null AI for openai/anthropic when the key is blank", () => {
    expect(
      buildServices(settingsWith({ aiProvider: "openai", aiApiKey: "" })).ai,
    ).toBeNull();
    expect(
      buildServices(settingsWith({ aiProvider: "anthropic", aiApiKey: "" })).ai,
    ).toBeNull();
  });

  it("builds the Ollama provider from its endpoint, ignoring the api key", () => {
    const svc = buildServices(
      settingsWith({
        aiProvider: "ollama",
        aiApiKey: "",
        ollamaEndpoint: "http://localhost:11434",
      }),
    );
    expect(svc.ai).not.toBeNull();
  });

  it("returns null AI for ollama when the endpoint is blank", () => {
    const svc = buildServices(
      settingsWith({ aiProvider: "ollama", ollamaEndpoint: "   " }),
    );
    expect(svc.ai).toBeNull();
    expect(svc.translator).toBeNull();
  });

  it("builds a local OpenSubtitles client when a key is set, null otherwise", () => {
    expect(
      buildServices(settingsWith({ openSubtitlesApiKey: "osk" })).subtitles,
    ).not.toBeNull();
    expect(
      buildServices(settingsWith({ openSubtitlesApiKey: "  " })).subtitles,
    ).toBeNull();
  });

  it("reports hasIndexers=false when built-ins are disabled and no active sources exist", () => {
    const svc = buildServices(
      settingsWith({ builtInIndexersEnabled: false, sources: [] }),
    );
    expect(svc.hasIndexers).toBe(false);
  });

  it("builds indexers from an active buildable source", () => {
    const svc = buildServices(
      settingsWith({
        builtInIndexersEnabled: false,
        sources: [
          { id: "j", type: "jackett", baseURL: "http://j", isActive: true },
        ],
      }),
    );
    expect(svc.hasIndexers).toBe(true);
  });

  it("skips inactive / empty-URL / non-web-buildable sources when building indexers", () => {
    const svc = buildServices(
      settingsWith({
        builtInIndexersEnabled: false,
        sources: [
          { id: "off", type: "jackett", baseURL: "http://x", isActive: false },
          { id: "empty", type: "jackett", baseURL: "   ", isActive: true },
        ],
      }),
    );
    // No buildable active source -> no active indexers.
    expect(svc.hasIndexers).toBe(false);
  });
});

describe("buildServices — Server Mode", () => {
  beforeEach(() => {
    isServerModeMock.mockReturnValue(true);
  });

  it("uses the server subtitle client + translator regardless of local keys", () => {
    const svc = buildServices(
      settingsWith({ openSubtitlesApiKey: "", aiApiKey: "" }),
    );
    // Server clients are always present in Server Mode (the constructor branch).
    expect(svc.subtitles).not.toBeNull();
    expect(svc.hasSubtitles).toBe(true);
    expect(svc.translator).not.toBeNull();
  });

  it("leaves services.omdb null in Server Mode when the user has no BYOK key", () => {
    const svc = buildServices(settingsWith({ omdbKey: "" }));
    // effectiveOmdbKey short-circuits to "" in Server Mode -> no client.
    expect(svc.omdb).toBeNull();
  });

  it("still honors a user-provided OMDb key in Server Mode (BYOK precedence)", () => {
    const svc = buildServices(settingsWith({ omdbKey: "BYOK" }));
    expect(svc.omdb).not.toBeNull();
  });
});

// ---- One-time premium-redesign appearance refresh ---------------------------

describe("applyDesignRefresh", () => {
  function stubLocalStorage(): Map<string, string> {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
    return m;
  }

  it("adopts the premium spatial defaults on first run, once", () => {
    stubLocalStorage();
    const cramped = settingsWith({
      appearanceDensity: "compact",
      appearanceTextSize: "s",
      appearanceRadius: "sharp",
      appearanceHeroScale: "compact",
      appearancePosterSize: "compact",
      appearanceBackdrop: "plain",
    });

    const refreshed = applyDesignRefresh(cramped);
    const d = defaultSettings();
    expect(refreshed.appearanceDensity).toBe(d.appearanceDensity);
    expect(refreshed.appearanceRadius).toBe(d.appearanceRadius);
    expect(refreshed.appearanceHeroScale).toBe(d.appearanceHeroScale);
    expect(refreshed.appearancePosterSize).toBe(d.appearancePosterSize);
    expect(refreshed.appearanceBackdrop).toBe(d.appearanceBackdrop);

    // Second run is a no-op (same reference back) — never resets twice.
    const again = applyDesignRefresh(
      settingsWith({ appearanceRadius: "sharp" }),
    );
    expect(again.appearanceRadius).toBe("sharp");
  });

  it("never touches theme, accent, keys, or debrid tokens", () => {
    stubLocalStorage();
    const input = settingsWith({
      theme: "light",
      appearanceAccent: "amber",
      omdbKey: "SECRET",
      appearanceDensity: "compact",
    });
    const out = applyDesignRefresh(input);
    expect(out.theme).toBe("light");
    expect(out.appearanceAccent).toBe("amber");
    expect(out.omdbKey).toBe("SECRET");
    // ...but the spatial lever was still refreshed.
    expect(out.appearanceDensity).toBe(defaultSettings().appearanceDensity);
  });

  it("is a safe no-op when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    const input = settingsWith({ appearanceRadius: "sharp" });
    expect(applyDesignRefresh(input)).toBe(input);
  });
});
