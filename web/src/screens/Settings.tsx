// Settings screen — on-brand tabbed config, persisted through the app store.
//
// Three tabs:
//   • API keys — TMDB / OMDB metadata keys + the AI provider (kind, key, model).
//   • Debrid — per-service tokens (Real-Debrid / AllDebrid / Premiumize / TorBox),
//     in priority order.
//   • Sources — the built-in scrapers toggle + a list of external indexers
//     (Torznab / Jackett / Prowlarr / Zilean / Stremio add-ons).
//
// Saving writes through the store (updateSettings → saveSettings), which rebuilds
// the shared service instances, so a TMDB key entered here immediately lights up
// live data elsewhere. Credential values are routed through the SecretStore
// abstraction; desktop builds can back that with native secure storage.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import QRCode from "qrcode";
import { useAppStore } from "../store/AppStore";
import {
  useServerSession,
  useTranscodeAvailable,
  useSetServerSession,
} from "../lib/ServerSessionContext";
import { notifyUnauthorized, readCsrfToken } from "../lib/serverSession";
import { isSmartPreloadEnabled, setSmartPreloadEnabled } from "../lib/smartPreload";
import type { AccountProfile, RequestRecord } from "../lib/serverApi";
import { fetchAccountProfiles, setProfileMaturity } from "../lib/serverApi";
import type {
  AppSettings,
  AppearanceAccent,
  AppearanceBackdrop,
  AppearanceChrome,
  AppearanceDensity,
  AppearanceHeroScale,
  AppearanceMotion,
  AppearanceNavLabels,
  AppearanceNavTint,
  AppearancePanelContrast,
  AppearancePosterSize,
  AppearanceRadius,
  AppearanceTextSize,
  SourceEntry,
  StreamMaxQuality,
} from "../data/settings";
import { DebridServiceType } from "../services/debrid/models";
import { AIProviderKind } from "../services/ai/models";
import type { StoredIndexerType } from "../storage/models";
import { Icon } from "../components/Icon";
import { AdvancedOnly } from "../components/AdvancedOnly";
import { ACCENTS, THEMES } from "../theme/themes";
import {
  configuredServerURL,
  configuredServerURLSource,
  isServerMode,
  saveServerURL,
} from "../lib/serverMode";
import {
  desktopServerStatus,
  isTauri,
  openExternalURL,
  startDesktopServer,
  stopDesktopServer,
  type DesktopServerStatus,
} from "../lib/tauri";
import "./Settings.css";

/** The selectable external-source types. */
const SOURCE_TYPES: StoredIndexerType[] = [
  "torznab",
  "jackett",
  "prowlarr",
  "zilean",
  "stremio_addon",
];

const CUSTOM_SOURCE_URL = "__custom";

interface SourcePreset {
  id: string;
  label: string;
  type: StoredIndexerType;
  baseURL: string;
  displayName: string;
  note: string;
}

const SOURCE_PRESETS: SourcePreset[] = [
  {
    id: "jackett-local",
    label: "Jackett local",
    type: "jackett",
    baseURL: "http://localhost:9117",
    displayName: "Jackett",
    note: "Uses Jackett's all-indexers Torznab API.",
  },
  {
    id: "prowlarr-local",
    label: "Prowlarr local",
    type: "prowlarr",
    baseURL: "http://localhost:9696",
    displayName: "Prowlarr",
    note: "Sends the API key as the Prowlarr header.",
  },
  {
    id: "zilean-local",
    label: "Zilean local",
    type: "zilean",
    baseURL: "http://localhost:8181",
    displayName: "Zilean",
    note: "Torznab-compatible Zilean endpoint.",
  },
  {
    id: "stremio-torrentio",
    label: "Torrentio addon",
    type: "stremio_addon",
    baseURL: "https://torrentio.strem.fun",
    displayName: "Torrentio",
    note: "Manifest URLs also work; playback resolves through stream endpoints.",
  },
  {
    id: "torznab-custom",
    label: "Custom Torznab URL",
    type: "torznab",
    baseURL: "http://localhost:9117",
    displayName: "Torznab",
    note: "Generic Torznab base URL for custom endpoints.",
  },
];

interface AppearanceProfile {
  id: string;
  label: string;
  description: string;
  settings: Pick<
    AppSettings,
    | "theme"
    | "appearanceAccent"
    | "appearanceDensity"
    | "appearanceTextSize"
    | "appearanceMotion"
    | "appearanceRadius"
    | "appearanceBlur"
    | "appearanceChrome"
    | "appearanceBackdrop"
    | "appearanceHeroScale"
    | "appearancePanelContrast"
    | "appearanceNavLabels"
    | "appearanceNavTint"
    | "appearancePosterSize"
  >;
}

const CUSTOM_APPEARANCE_PROFILE = "__custom";

const APPEARANCE_PROFILES: AppearanceProfile[] = [
  {
    id: "default-cinema",
    label: "Cinema room",
    description: "Dark Aurora panels, comfortable spacing, system motion.",
    settings: {
      theme: "aurora",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "m",
      appearanceMotion: "system",
      appearanceRadius: "default",
      appearanceBlur: 18,
      appearanceChrome: "balanced",
      appearanceBackdrop: "ambient",
      appearanceHeroScale: "standard",
      appearancePanelContrast: "standard",
      appearanceNavLabels: "auto",
      appearanceNavTint: "balanced",
      appearancePosterSize: "default",
    },
  },
  {
    id: "compact-control",
    label: "Compact control",
    description: "Tighter panels for desktop remotes and dense libraries.",
    settings: {
      theme: "midnight",
      appearanceAccent: "cyan",
      appearanceDensity: "compact",
      appearanceTextSize: "s",
      appearanceMotion: "normal",
      appearanceRadius: "sharp",
      appearanceBlur: 12,
      appearanceChrome: "solid",
      appearanceBackdrop: "plain",
      appearanceHeroScale: "compact",
      appearancePanelContrast: "high",
      appearanceNavLabels: "icons",
      appearanceNavTint: "solid",
      appearancePosterSize: "compact",
    },
  },
  {
    id: "daylight-room",
    label: "Daylight room",
    description: "Bright Daybreak skin with larger text and softer corners.",
    settings: {
      theme: "light",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "l",
      appearanceMotion: "system",
      appearanceRadius: "round",
      appearanceBlur: 14,
      appearanceChrome: "balanced",
      appearanceBackdrop: "subtle",
      appearanceHeroScale: "cinematic",
      appearancePanelContrast: "standard",
      appearanceNavLabels: "labels",
      appearanceNavTint: "airy",
      appearancePosterSize: "large",
    },
  },
  {
    id: "quiet-focus",
    label: "Quiet focus",
    description: "Low-glow dark mode with reduced motion and solid glass.",
    settings: {
      theme: "midnight",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "m",
      appearanceMotion: "reduced",
      appearanceRadius: "default",
      appearanceBlur: 10,
      appearanceChrome: "solid",
      appearanceBackdrop: "subtle",
      appearanceHeroScale: "standard",
      appearancePanelContrast: "soft",
      appearanceNavLabels: "auto",
      appearanceNavTint: "solid",
      appearancePosterSize: "default",
    },
  },
];

function sourceTypeLabel(type: StoredIndexerType): string {
  switch (type) {
    case "torznab":
      return "Torznab";
    case "jackett":
      return "Jackett";
    case "prowlarr":
      return "Prowlarr";
    case "zilean":
      return "Zilean";
    case "stremio_addon":
      return "Stremio Addon";
    case "built_in":
      return "Built-in Scrapers";
  }
}

function sourcePreset(id: string): SourcePreset {
  return SOURCE_PRESETS.find((preset) => preset.id === id) ?? SOURCE_PRESETS[0];
}

function defaultSourcePreset(type: StoredIndexerType): SourcePreset {
  return SOURCE_PRESETS.find((preset) => preset.type === type) ?? SOURCE_PRESETS[0];
}

function sourceURLChoices(type: StoredIndexerType, current: string) {
  const base = SOURCE_PRESETS.filter((preset) => preset.type === type).map((preset) => ({
    label: preset.label,
    value: preset.baseURL,
  }));
  const trimmed = current.trim();
  return trimmed.length > 0 && !base.some((option) => option.value === trimmed)
    ? [{ label: "Current custom URL", value: trimmed }, ...base]
    : base;
}

function appearanceProfileMatches(
  draft: AppSettings,
  profile: AppearanceProfile,
): boolean {
  const settings = profile.settings;
  return (
    draft.theme === settings.theme &&
    draft.appearanceAccent === settings.appearanceAccent &&
    draft.appearanceDensity === settings.appearanceDensity &&
    draft.appearanceTextSize === settings.appearanceTextSize &&
    draft.appearanceMotion === settings.appearanceMotion &&
    draft.appearanceRadius === settings.appearanceRadius &&
    draft.appearanceBlur === settings.appearanceBlur &&
    draft.appearanceChrome === settings.appearanceChrome &&
    draft.appearanceBackdrop === settings.appearanceBackdrop &&
    draft.appearanceHeroScale === settings.appearanceHeroScale &&
    draft.appearancePanelContrast === settings.appearancePanelContrast &&
    draft.appearanceNavLabels === settings.appearanceNavLabels &&
    draft.appearanceNavTint === settings.appearanceNavTint &&
    draft.appearancePosterSize === settings.appearancePosterSize
  );
}

type Tab =
  | "keys"
  | "debrid"
  | "sources"
  | "appearance"
  | "playback"
  | "updates"
  | "install"
  | "server";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "playback", label: "Playback" },
  { id: "install", label: "Install & setup" },
  { id: "updates", label: "Updates" },
  { id: "server", label: "Server" },
  { id: "keys", label: "API keys" },
  { id: "debrid", label: "Providers" },
  { id: "sources", label: "Sources" },
];

// Tabs visible in Simple mode (progressive disclosure). Advanced unlocks the
// rest (Updates, Server, Sources). Server is also hidden in Local Mode.
const SIMPLE_TABS = new Set<Tab>([
  "appearance",
  "playback",
  "install",
  "keys",
  "debrid",
]);

/** Pure, testable tab filter for the current modes. */
export function visibleTabs(opts: {
  serverMode: boolean;
  simpleMode: boolean;
}): { id: Tab; label: string }[] {
  return TABS.filter((t) => {
    if (!opts.serverMode && t.id === "server") return false;
    if (opts.simpleMode && !SIMPLE_TABS.has(t.id)) return false;
    return true;
  });
}

type ServerRole = "owner" | "admin" | "member" | "restricted";

interface ServerProfile {
  id: string;
  username?: string;
  displayName: string;
  role: ServerRole;
  simpleMode?: boolean;
  disabled?: boolean;
  self?: boolean;
}

interface ServerUsageSession {
  id: string;
  title: string | null;
  createdAt: string;
  bytesServed: number;
  lastAccessedAt: string | null;
  completedAt: string | null;
  lastStatus: number | null;
}

interface ServerUsageProfile {
  profileId: string;
  username: string;
  displayName: string;
  role: ServerRole;
  totalBytes: number;
  streamCount: number;
  lastAccessedAt: string | null;
}

interface ServerUsage {
  days: number;
  totalBytes: number;
  streamCount: number;
  lastAccessedAt?: string | null;
  sessions?: ServerUsageSession[];
  profiles?: ServerUsageProfile[];
}

interface ServerHealth {
  ok: boolean;
  serverTime: string;
  setupRequired: boolean;
  counts: {
    users: number;
    profiles: number;
    activeSessions: number;
    activeStreamSessions: number;
    credentials: number;
    activeInvites: number;
    auditEvents: number;
    recentStreamErrors: number;
  };
  config: {
    cookieSecure: boolean;
    cookieSameSite: string;
    trustProxy: boolean;
    corsConfigured: boolean;
    rawStreamUrlsEnabled: boolean;
    webDistConfigured: boolean;
    sessionTtlSeconds: number;
  };
  warnings: string[];
}

interface ActiveStreamSession {
  id: string;
  profileId: string;
  username: string;
  displayName: string;
  title: string | null;
  contentType: string | null;
  createdAt: string;
  expiresAt: string;
  bytesServed: number;
  lastAccessedAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

interface ServerSessionEntry {
  id: string;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
  active: boolean;
}

interface ServerInvite {
  id: string;
  label: string | null;
  role: Exclude<ServerRole, "owner">;
  simpleMode: boolean;
  maxUses: number;
  usedCount: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

interface ServerAuditEvent {
  id: string;
  actorUserId: string | null;
  actorProfileId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

type CredentialProvider =
  | "tmdb"
  | "omdb"
  | "real_debrid"
  | "all_debrid"
  | "premiumize"
  | "torbox"
  | "openai"
  | "anthropic"
  | "ollama"
  | "opensubtitles"
  | "trakt";

interface EffectiveCredential {
  id: string | null;
  provider: CredentialProvider;
  scope: "server" | "profile" | null;
  label: string | null;
  priority?: number;
  isActive?: boolean;
  updatedAt?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface HealthResponse {
  ok: boolean;
  setupRequired?: boolean;
}

type DeviceKind = "ios" | "android" | "mac" | "windows" | "linux" | "desktop" | "unknown";
type InstallPath = "device" | "connect" | "downloads" | "deploy";

function deviceKind(): DeviceKind {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (platform.includes("mac") && touchPoints > 1) return "ios";
  if (ua.includes("android")) return "android";
  if (platform.includes("mac") || ua.includes("mac os")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("x11")) return "linux";
  if (/desktop|cros/.test(ua)) return "desktop";
  return "unknown";
}

function isStandaloneDisplay(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatShortDate(value: string | null | undefined): string {
  if (value == null) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function inferServerURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) throw new Error("Enter a server URL.");
  if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).toString().replace(/\/+$/, "");

  const host = trimmed.split("/", 1)[0] ?? trimmed;
  const local =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith(".local") ||
    host.includes(".local:");
  const scheme = local ? "http" : "https";
  return new URL(`${scheme}://${trimmed}`).toString().replace(/\/+$/, "");
}

async function serverRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseURL = configuredServerURL();
  if (baseURL == null) throw new Error("Server Mode is not configured.");
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    // Canonical CSRF source: prefers the in-memory token captured at bootstrap
    // and only falls back to document.cookie same-origin — a cross-origin
    // (pasted remote URL) client can't read the server origin's ds_csrf cookie.
    const csrf = readCsrfToken();
    if (csrf != null) headers["x-csrf-token"] = csrf;
  }
  const response = await fetch(`${baseURL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Non-JSON body (e.g. a reverse-proxy 5xx) — fall through to a status error.
    }
  }
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw new Error(
      typeof parsed.error === "string"
        ? parsed.error
        : `Server request failed (${response.status}).`,
    );
  }
  return parsed as T;
}

export function Settings() {
  const { settings, updateSettings, simpleMode } = useAppStore();
  const serverSession = useServerSession();
  const setServerSession = useSetServerSession();
  const [tab, setTab] = useState<Tab>("appearance");
  // Edit a local draft; "Save" commits it through the store.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  function patch(next: Partial<AppSettings>) {
    setDraft((d) => ({ ...d, ...next }));
    setSaved(false);
  }

  function save() {
    updateSettings(draft);
    setSaved(true);
  }

  function applyAppearance(next: Partial<AppSettings>) {
    // Appearance controls are instant-apply. Reflect the change in the preview
    // draft, but PERSIST only the appearance change layered on the last-SAVED
    // settings — NOT the whole draft. Persisting the draft would silently commit
    // unsaved edits from other tabs (e.g. a half-typed API key or debrid token)
    // and wrongly clear the "unsaved changes" indicator on a mere theme nudge.
    setDraft((d) => ({ ...d, ...next }));
    updateSettings({ ...settings, ...next });
    setSaved(true);
  }

  const serverMode = isServerMode();
  const tabs = visibleTabs({ serverMode, simpleMode });

  // Redirect off a now-hidden tab (e.g. after flipping to Simple while on
  // Server/Sources/Updates) so the user never lands on a blank pane.
  useEffect(() => {
    if (!visibleTabs({ serverMode, simpleMode }).some((t) => t.id === tab)) {
      setTab("appearance");
    }
  }, [serverMode, simpleMode, tab]);

  // Toggle the experience tier. Local Mode persists to AppSettings; Server Mode
  // PATCHes the profile's simple_mode and optimistically updates the session.
  const setExperience = useCallback(
    (simple: boolean) => {
      if (isServerMode()) {
        const base = configuredServerURL();
        const profileId = serverSession?.profileId;
        if (base == null || profileId == null) return;
        const csrf = readCsrfToken();
        void fetch(`${base}/api/profiles/${encodeURIComponent(profileId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...(csrf != null ? { "x-csrf-token": csrf } : {}),
          },
          body: JSON.stringify({ simpleMode: simple }),
        }).catch(() => {});
        if (serverSession != null) {
          setServerSession({ ...serverSession, simpleMode: simple });
        }
      } else {
        updateSettings({ ...settings, simpleMode: simple });
      }
    },
    [settings, updateSettings, serverSession, setServerSession],
  );

  const selectedTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const selectedProfile =
    APPEARANCE_PROFILES.find((profile) => appearanceProfileMatches(draft, profile)) ??
    null;
  const configuredDebridCount = draft.debridTokens.filter(
    (entry) => entry.apiToken.trim().length > 0,
  ).length;
  const activeSourceCount =
    draft.sources.filter((source) => source.isActive).length +
    (draft.builtInIndexersEnabled ? 1 : 0);
  const metadataState =
    draft.tmdbKey.trim().length > 0 ? "Live catalog" : "Built-in catalog";
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings),
    [draft, settings],
  );
  const saveLabel = hasUnsavedChanges ? "Save changes" : saved ? "Saved" : "Up to date";
  const saveNote = hasUnsavedChanges
    ? "Unsaved changes are local until you save this profile."
    : "Profile saved · credentials protected";

  return (
    <div className="settings-screen">
      <header className="settings-header settings-hero glass-raised glass-lit">
        <div className="settings-title-block">
          <div className="settings-kicker">
            <Icon name="settings" size={15} />
            <span>Control center</span>
          </div>
          <h1 className="settings-h1">Settings</h1>
          <p className="settings-subtitle t-secondary">
            {selectedTab.label} controls for this profile, device, and server session.
          </p>
          <div className="settings-insight-grid" aria-label="Settings summary">
            <button
              type="button"
              className="settings-insight"
              onClick={() => setTab("appearance")}
            >
              <span>Appearance</span>
              <strong>{selectedProfile?.label ?? "Custom current"}</strong>
            </button>
            <button
              type="button"
              className="settings-insight"
              onClick={() => setTab("keys")}
            >
              <span>Catalog</span>
              <strong>{metadataState}</strong>
            </button>
            <button
              type="button"
              className="settings-insight"
              onClick={() => setTab("debrid")}
            >
              <span>Providers</span>
              <strong>
                {configuredDebridCount === 0
                  ? "No stream provider"
                  : `${configuredDebridCount} provider${configuredDebridCount === 1 ? "" : "s"}`}
              </strong>
            </button>
            <button
              type="button"
              className="settings-insight"
              onClick={() => setTab("sources")}
            >
              <span>Sources</span>
              <strong>
                {activeSourceCount} catalog source{activeSourceCount === 1 ? "" : "s"}
              </strong>
            </button>
          </div>
        </div>

        {tab !== "install" && (
          <div className={`settings-footer${hasUnsavedChanges ? " is-dirty" : " is-clean"}`}>
            <span className="settings-note t-secondary" aria-live="polite">
              {saveNote}
            </span>
            <button
              type="button"
              className="btn btn-prominent"
              onClick={save}
              disabled={!hasUnsavedChanges}
              aria-label={saveLabel}
              title={saveLabel}
            >
              <Icon
                name={hasUnsavedChanges ? "save" : "check"}
                size={16}
                className="settings-save-icon"
              />
              <span className="settings-save-label">{saveLabel}</span>
            </button>
          </div>
        )}
      </header>

      <div className="settings-experience">
        <SegmentedControl
          label="Experience"
          value={simpleMode ? "simple" : "advanced"}
          options={[
            { value: "simple", label: "Simple" },
            { value: "advanced", label: "Advanced" },
          ]}
          onChange={(v) => setExperience(v === "simple")}
        />
        <p className="settings-experience-hint t-secondary">
          {simpleMode
            ? "Simple shows the essentials. Switch to Advanced for sources, updates, and every dial."
            : "Advanced reveals all tabs and controls."}
        </p>
      </div>

      <label className="settings-tab-select">
        <span className="settings-label">Settings category</span>
        <select value={tab} onChange={(event) => setTab(event.target.value as Tab)}>
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-tab={t.id}
            className={`chip${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel glass-raised glass-lit">
        {tab === "appearance" && (
          <AppearanceTab
            draft={draft}
            applyAppearance={applyAppearance}
          />
        )}
        {tab === "install" && <InstallTab />}
        {tab === "playback" && <PlaybackTab draft={draft} patch={patch} />}
        {tab === "updates" && <UpdatesTab draft={draft} patch={patch} />}
        {tab === "server" && <ServerTab />}
        {tab === "keys" && <KeysTab draft={draft} patch={patch} />}
        {tab === "debrid" && <DebridTab draft={draft} patch={patch} />}
        {tab === "sources" && <SourcesTab draft={draft} patch={patch} />}
      </div>
    </div>
  );
}

function UpdatesTab({ draft, patch }: TabProps) {
  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        Desktop builds use signed release metadata from GitHub Releases. Browser
        and PWA installs update through the web server instead.
      </p>

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.autoUpdateChecks}
          onChange={(event) =>
            patch({
              autoUpdateChecks: event.target.checked,
              autoInstallUpdates: event.target.checked
                ? draft.autoInstallUpdates
                : false,
            })
          }
        />
        <span>
          <strong>Check for desktop updates on launch</strong>
          <span className="t-secondary"> — shows a signed update prompt.</span>
        </span>
      </label>

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.autoUpdateChecks && draft.autoInstallUpdates}
          disabled={!draft.autoUpdateChecks}
          onChange={(event) => patch({ autoInstallUpdates: event.target.checked })}
        />
        <span>
          <strong>Install signed desktop updates automatically</strong>
          <span className="t-secondary"> — downloads, applies, and relaunches.</span>
        </span>
      </label>
    </div>
  );
}

interface TabProps {
  draft: AppSettings;
  patch: (next: Partial<AppSettings>) => void;
}

const STREAM_QUALITY_OPTIONS: { value: StreamMaxQuality; label: string }[] = [
  { value: "any", label: "Any quality" },
  { value: "4K", label: "Up to 4K" },
  { value: "1080p", label: "Up to 1080p" },
  { value: "720p", label: "Up to 720p" },
  { value: "480p", label: "Up to 480p" },
  { value: "SD", label: "SD only" },
];

const STREAM_SIZE_CAP_OPTIONS = [
  { value: 0, label: "No cap" },
  { value: 2, label: "Up to 2 GB" },
  { value: 5, label: "Up to 5 GB" },
  { value: 10, label: "Up to 10 GB" },
  { value: 20, label: "Up to 20 GB" },
  { value: 50, label: "Up to 50 GB" },
] as const;

const CUSTOM_STREAM_SIZE_CAP = "custom";

function PlaybackTab({ draft, patch }: TabProps) {
  const sizeCapOption =
    STREAM_SIZE_CAP_OPTIONS.find((option) => option.value === draft.streamMaxSizeGB) ??
    null;
  const sizeCapValue =
    sizeCapOption == null ? CUSTOM_STREAM_SIZE_CAP : String(sizeCapOption.value);
  // The server-transcode option is only meaningful in Server Mode AND only when
  // the operator enabled it (+ ffmpeg present), advertised via bootstrap.
  const canTranscode = isServerMode() && useTranscodeAvailable();

  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        These profile controls hide stream results that are likely to use more
        bandwidth. <strong>Data Saver</strong> adds a ≤720p / ≤5&nbsp;GB ceiling on
        top and also governs automatic (watchlist) playback. Server Mode applies
        them before sending stream rows to this device.
      </p>

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.dataSaver}
          onChange={(event) => patch({ dataSaver: event.target.checked })}
        />
        <span>
          <strong>Data Saver</strong>
          <span className="t-secondary"> — prefer smaller, lower-resolution sources (≤720p, ≤5&nbsp;GB) to use less bandwidth, including for instant/watchlist playback. No re-encoding.</span>
        </span>
      </label>

      {canTranscode && (
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.transcode}
            onChange={(event) => patch({ transcode: event.target.checked })}
          />
          <span>
            <strong>Reduce playback bitrate (server transcode)</strong>
            <span className="t-secondary"> — the server re-encodes playback to a 720p stream to use less bandwidth (uses more server CPU). Complements Data Saver, which only caps the source file picked.</span>
          </span>
        </label>
      )}

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.streamCachedOnly}
          onChange={(event) => patch({ streamCachedOnly: event.target.checked })}
        />
        <span>
          <strong>Show cached streams only</strong>
          <span className="t-secondary"> — avoids streams that need to be cached first.</span>
        </span>
      </label>

      {/* Quality + size caps are power-user filters — hidden in Simple mode,
          which keeps "cached only" as the one safe, essential toggle. */}
      <AdvancedOnly>
        <Field
          label="Maximum quality"
          hint="Higher-quality torrents are hidden from stream results."
        >
          <select
            value={draft.streamMaxQuality}
            onChange={(event) =>
              patch({ streamMaxQuality: event.target.value as StreamMaxQuality })
            }
          >
            {STREAM_QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </AdvancedOnly>

      <AdvancedOnly>
      <Field
        label="Maximum file size"
        hint="Common caps are listed first. Custom still filters torrent result size, not transcoded playback bitrate."
      >
        <div className="settings-size-cap">
          <select
            value={sizeCapValue}
            onChange={(event) => {
              if (event.target.value === CUSTOM_STREAM_SIZE_CAP) {
                patch({
                  streamMaxSizeGB:
                    sizeCapOption == null && draft.streamMaxSizeGB > 0
                      ? draft.streamMaxSizeGB
                      : 25,
                });
                return;
              }
              patch({ streamMaxSizeGB: Number(event.target.value) });
            }}
          >
            {STREAM_SIZE_CAP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM_STREAM_SIZE_CAP}>Custom</option>
          </select>
          {sizeCapOption == null && (
            <input
              type="number"
              min={0}
              max={500}
              step={0.5}
              value={draft.streamMaxSizeGB}
              onChange={(event) =>
                patch({ streamMaxSizeGB: Number(event.target.value) || 0 })
              }
              aria-label="Custom maximum file size in GB"
            />
          )}
        </div>
      </Field>
      </AdvancedOnly>
    </div>
  );
}

function InstallTab() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());
  const [installPath, setInstallPath] = useState<InstallPath>("device");
  const kind = deviceKind();

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall() {
    if (promptEvent == null) return;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    setPromptEvent(null);
    setInstalled(isStandaloneDisplay());
  }

  const primary =
    kind === "ios"
      ? {
          title: "Install on iPhone or iPad",
          body: "Open this server URL in Safari, use Share, then Add to Home Screen.",
        }
      : kind === "android"
        ? {
            title: "Install on Android",
            body: "Use the browser install prompt when available, or Install app from Chrome or Edge.",
          }
        : kind === "mac"
          ? {
              title: "Mac setup",
              body: "Use the desktop app for native playback and signed updates, or keep this server URL pinned in your browser.",
            }
          : {
              title: "Install this server",
              body: "Use your browser's install app action to add this self-hosted server to your launcher.",
            };
  const installPathOptions: Array<{
    id: InstallPath;
    label: string;
    summary: string;
  }> = [
    {
      id: "device",
      label: installed ? "Installed app" : primary.title,
      summary: installed
        ? "This device already has launcher access."
        : "Set up launcher access or desktop hosting on this device.",
    },
    {
      id: "connect",
      label: "Connect to server",
      summary: "Use a hosted DebridStreamer URL for shared profiles and keys.",
    },
    {
      id: "downloads",
      label: "Desktop downloads",
      summary: "Get native Mac, Windows, and Linux builds.",
    },
    {
      id: "deploy",
      label: "Server setup",
      summary: "Deploy Docker Compose on a NAS, VPS, or home server.",
    },
  ];

  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        Set up this device for native playback, launcher access, and self-hosted
        streaming. The options below adjust to the browser or desktop app you are
        using now.
      </p>

      <div className="settings-install-picker">
        <label className="settings-label" htmlFor="settings-install-path">
          Setup path
        </label>
        <select
          id="settings-install-path"
          value={installPath}
          onChange={(event) => setInstallPath(event.target.value as InstallPath)}
        >
          {installPathOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-install-choices" aria-label="Setup path">
        {installPathOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={installPath === option.id}
            className={`settings-install-choice${installPath === option.id ? " is-active" : ""}`}
            onClick={() => setInstallPath(option.id)}
          >
            <span>{option.label}</span>
            <small>{option.summary}</small>
          </button>
        ))}
      </div>

      <div className="settings-install-detail">
        {installPath === "device" && (
          <>
            <div className="settings-install-card glass-rest">
              <div>
                <h3>{installed ? "Installed" : primary.title}</h3>
                <p className="t-secondary">
                  {installed
                    ? "This server is already running as an installed app."
                    : primary.body}
                </p>
              </div>
              {promptEvent != null && !installed && (
                <button type="button" className="btn" onClick={() => void promptInstall()}>
                  Install app
                </button>
              )}
            </div>
            <DesktopHostPanel />
          </>
        )}

        {installPath === "connect" && <ServerConnectionPanel />}

        {installPath === "downloads" && (
          <div className="settings-install-grid">
            <a
              className="settings-install-card glass-rest"
              href="https://github.com/Tgk-30/DebridStreamer/releases/latest"
              target="_blank"
              rel="noreferrer"
            >
              <strong>Desktop downloads</strong>
              <span className="t-secondary">
                Mac, Windows, and Linux release assets with signed update support.
              </span>
            </a>
          </div>
        )}

        {installPath === "deploy" && (
          <div className="settings-install-grid">
            <a
              className="settings-install-card glass-rest"
              href="https://github.com/Tgk-30/DebridStreamer/tree/main/deploy/compose"
              target="_blank"
              rel="noreferrer"
            >
              <strong>Server setup</strong>
              <span className="t-secondary">
                Docker Compose files for NAS, VPS, Raspberry Pi, and home servers.
              </span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopHostPanel() {
  const [status, setStatus] = useState<DesktopServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const desktop = isTauri();
  const shareURL =
    status?.share_url ?? status?.lan_urls[0] ?? status?.url ?? status?.urls[0] ?? null;
  const setupURL = status?.setup_url ?? null;
  const primaryURL = setupURL ?? shareURL;

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void desktopServerStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  useEffect(() => {
    let cancelled = false;
    if (!desktop || primaryURL == null) {
      setQrDataURL(null);
      return;
    }
    void QRCode.toDataURL(primaryURL, {
      width: 180,
      margin: 1,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    })
      .then((dataURL) => {
        if (!cancelled) setQrDataURL(dataURL);
      })
      .catch(() => {
        if (!cancelled) setQrDataURL(null);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, primaryURL]);

  if (!desktop) return null;

  async function start() {
    setBusy(true);
    setError(null);
    setShareMessage(null);
    try {
      const next = await startDesktopServer();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    setShareMessage(null);
    try {
      const next = await stopDesktopServer();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openServer() {
    if (primaryURL == null) return;
    await openExternalURL(primaryURL);
  }

  async function copyShareURL(url: string) {
    setError(null);
    setShareMessage(null);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Copied.");
    } catch {
      setError("Clipboard is unavailable in this session.");
    }
  }

  async function shareHostedApp() {
    if (primaryURL == null) return;
    setError(null);
    setShareMessage(null);
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share == null) {
      await copyShareURL(primaryURL);
      return;
    }
    try {
      await nav.share({
        title: "DebridStreamer",
        text: "Open this DebridStreamer server.",
        url: primaryURL,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Share failed.");
    }
  }

  return (
    <div className="settings-source glass-rest settings-server-connect">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Host from this desktop</span>
        {status?.running && <span className="chip is-active">Running</span>}
      </div>
      <p className="settings-hint t-secondary">
        Start Server Mode on this computer, then open the hosted app URL for
        profiles, shared credentials, and phone/tablet home-screen installs.
      </p>
      <div className="settings-source-row">
        <button
          type="button"
          className="btn"
          onClick={() => void start()}
          disabled={busy || status?.running === true}
        >
          {busy && status?.running !== true ? "Starting" : "Start hosting"}
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => void stop()}
          disabled={busy || status?.running !== true}
        >
          Stop
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => void openServer()}
          disabled={primaryURL == null}
        >
          Open hosted app
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => void shareHostedApp()}
          disabled={primaryURL == null}
        >
          Share
        </button>
      </div>
      {primaryURL != null && (
        <div className="settings-share-box">
          {qrDataURL != null && (
            <img
              className="settings-share-qr"
              src={qrDataURL}
              alt="QR code for the hosted DebridStreamer server"
            />
          )}
          <div className="settings-share-copy">
            <span className="settings-label">
              {setupURL != null ? "One-time owner setup URL" : "Best setup URL"}
            </span>
            <code>{primaryURL}</code>
            {setupURL != null && (
              <span className="settings-hint t-secondary">
                Use this first-run link to create the owner account. Normal
                sharing links are listed below.
              </span>
            )}
            <div className="settings-source-row">
              <button
                type="button"
                className="chip"
                onClick={() => void copyShareURL(primaryURL)}
              >
                Copy
              </button>
              {status?.url != null && status.url !== shareURL && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => void copyShareURL(status.url!)}
                >
                  Copy local
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {status?.running === true && status.urls.length > 1 && (
        <div className="settings-url-list">
          {status.urls.map((url) => (
            <button
              type="button"
              key={url}
              className="chip"
              onClick={() => void copyShareURL(url)}
            >
              {url}
            </button>
          ))}
        </div>
      )}
      {status != null && (
        <p className="settings-hint t-secondary">{status.detail}</p>
      )}
      {status?.running === true && status.lan_urls.length === 0 && status.share_url == null && (
        <p className="settings-hint t-secondary">
          I could not detect a LAN address. Set
          <code> DEBRIDSTREAMER_DESKTOP_SHARE_URL</code> when launching the app
          to show a Tailscale or tunnel URL here.
        </p>
      )}
      {shareMessage && <p className="settings-status">{shareMessage}</p>}
      {status?.available === false && (
        <p className="settings-hint t-secondary">
          Release builds include this server bundle during CI. Development builds
          need <code> cd server && npm run build</code> first.
        </p>
      )}
      {error && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}

function ServerConnectionPanel() {
  const activeURL = configuredServerURL();
  const source = configuredServerURLSource();
  const [input, setInput] = useState(activeURL ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const nextURL = inferServerURL(input);
      const response = await fetch(`${nextURL}/api/health`, {
        method: "GET",
        credentials: "include",
      });
      const text = await response.text();
      const parsed =
        text.length > 0 ? (JSON.parse(text) as Partial<HealthResponse>) : {};
      if (!response.ok || parsed.ok !== true) {
        throw new Error(`Server check failed (${response.status}).`);
      }
      saveServerURL(nextURL);
      setStatus(
        parsed.setupRequired
          ? "Connected. Owner setup will open next."
          : "Connected. Sign in will open next.",
      );
      window.setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    saveServerURL(null);
    window.location.reload();
  }

  const envLocked = source === "env" || source === "same-origin";

  return (
    <div className="settings-source glass-rest settings-server-connect">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Connect to a server</span>
        {activeURL != null && <span className="chip is-active">Server Mode</span>}
      </div>
      <p className="settings-hint t-secondary">
        Paste a DebridStreamer server URL to use shared profiles, shared API
        keys, and server-side stream forwarding across devices.
      </p>
      <div className="settings-source-row">
        <input
          className="settings-server-url-input"
          type="url"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://stream.example.com"
          disabled={envLocked}
        />
        <button
          type="button"
          className="btn"
          onClick={() => void connect()}
          disabled={busy || envLocked}
        >
          {busy ? "Checking" : activeURL == null ? "Connect" : "Reconnect"}
        </button>
        {activeURL != null && (
          <button
            type="button"
            className="chip"
            onClick={disconnect}
            disabled={envLocked}
            title={
              envLocked
                ? "This server URL was set by the app build configuration."
                : "Return this device to Local Mode."
            }
          >
            Use Local Mode
          </button>
        )}
      </div>
      <p className="settings-hint t-secondary">
        Example: <code>http://192.168.1.5:43110</code>
      </p>
      {envLocked && (
        <p className="settings-hint t-secondary">
          {source === "same-origin" ? (
            "This app was opened directly from the server, so it uses the same-origin API."
          ) : (
            <>
              This build is pinned to a server URL by
              <code> VITE_DEBRIDSTREAMER_SERVER_URL</code>.
            </>
          )}
        </p>
      )}
      <p className="settings-hint t-secondary">
        Opening the server URL directly is the simplest setup. Separate desktop
        builds may need that server to allow this app as a trusted origin.
      </p>
      {status && <p className="settings-status">{status}</p>}
      {error && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}

// Static guided setup for exposing a self-hosted server off the local network.
// Two tabbed tracks (Tailscale / Cloudflare Tunnel) with official links and the
// where-to-paste-the-URL note. No live integration — this is documentation that
// ships with the app so the owner doesn't have to leave to find it. The persona
// + server-setup wizards point here ("Settings → Server → Remote access").

interface RemoteAccessStep {
  title: string;
  detail: string;
}

const TAILSCALE_STEPS: RemoteAccessStep[] = [
  {
    title: "Install Tailscale on the server",
    detail:
      "Sign up free, then install Tailscale on the machine running DebridStreamer and run tailscale up. It joins your private mesh (a tailnet).",
  },
  {
    title: "Install Tailscale on your devices",
    detail:
      "Add the same Tailscale account on each phone, tablet, or laptop. They can now reach the server by its tailnet IP or MagicDNS name on any network.",
  },
  {
    title: "Optional: expose a public HTTPS URL with Funnel",
    detail:
      "Run tailscale funnel <port> (e.g. the server port shown above) to get a public https://<name>.ts.net URL for people not on your tailnet.",
  },
  {
    title: "Use the URL here",
    detail:
      "Paste the tailnet or Funnel URL into Connect to a server above (or set DEBRIDSTREAMER_DESKTOP_SHARE_URL when launching the desktop host). That URL is what you share in invites.",
  },
];

const CLOUDFLARE_STEPS: RemoteAccessStep[] = [
  {
    title: "Create a Cloudflare Tunnel",
    detail:
      "In the Cloudflare Zero Trust dashboard, create a tunnel and install cloudflared on the server (or run it via Docker alongside DebridStreamer).",
  },
  {
    title: "Route a hostname to the server",
    detail:
      "Add a public hostname (e.g. stream.yourdomain.com) and point it at http://localhost:<port> — the local DebridStreamer server port shown above.",
  },
  {
    title: "Run the connector",
    detail:
      "Start cloudflared with your tunnel token. Cloudflare now serves your hostname over HTTPS and forwards traffic to the server through the tunnel.",
  },
  {
    title: "Use the URL here",
    detail:
      "Paste https://stream.yourdomain.com into Connect to a server above (or set DEBRIDSTREAMER_DESKTOP_SHARE_URL for the desktop host). That URL is what you share in invites.",
  },
];

function RemoteAccessPanel() {
  const [track, setTrack] = useState<"tailscale" | "cloudflare">("tailscale");
  const steps = track === "tailscale" ? TAILSCALE_STEPS : CLOUDFLARE_STEPS;
  const guideURL =
    track === "tailscale"
      ? "https://tailscale.com/kb/1223/funnel"
      : "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/";

  return (
    <div className="settings-source glass-rest settings-remote-access">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Remote access</span>
        <span className="chip">Tunnel</span>
      </div>
      <p className="settings-hint t-secondary">
        Expose this self-hosted server to phones and tablets off your network
        with a tunnel — no router ports to open, and traffic stays encrypted.
      </p>

      <div className="settings-source-row">
        <SegmentedControl
          label="Method"
          value={track}
          options={[
            { value: "tailscale", label: "Tailscale" },
            { value: "cloudflare", label: "Cloudflare Tunnel" },
          ]}
          onChange={(value) => setTrack(value as "tailscale" | "cloudflare")}
        />
      </div>

      <ol className="settings-remote-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="settings-remote-step">
            <span className="settings-remote-step-num">{index + 1}</span>
            <span className="settings-remote-step-body">
              <strong>{step.title}</strong>
              <span className="t-secondary">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="settings-source-row">
        <a className="chip" href={guideURL} target="_blank" rel="noreferrer">
          {track === "tailscale" ? "Tailscale Funnel guide" : "Cloudflare Tunnel guide"}
        </a>
        <a
          className="chip"
          href="https://tailscale.com/download"
          target="_blank"
          rel="noreferrer"
        >
          Download Tailscale
        </a>
        <a
          className="chip"
          href="https://one.dash.cloudflare.com/"
          target="_blank"
          rel="noreferrer"
        >
          Cloudflare Zero Trust
        </a>
      </div>
      <p className="settings-hint t-secondary">
        Once you have the public URL, paste it into <strong>Connect to a
        server</strong> above. The desktop host can also show it automatically —
        launch with <code>DEBRIDSTREAMER_DESKTOP_SHARE_URL</code> set.
      </p>
    </div>
  );
}

const CREDENTIAL_OPTIONS: { provider: CredentialProvider; label: string }[] = [
  { provider: "tmdb", label: "TMDB" },
  { provider: "omdb", label: "OMDB" },
  { provider: "real_debrid", label: "Real-Debrid" },
  { provider: "all_debrid", label: "AllDebrid" },
  { provider: "premiumize", label: "Premiumize" },
  { provider: "torbox", label: "TorBox" },
  { provider: "openai", label: "OpenAI" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "ollama", label: "Ollama" },
  { provider: "opensubtitles", label: "OpenSubtitles" },
  { provider: "trakt", label: "Trakt" },
];

function credentialProviderLabel(provider: CredentialProvider): string {
  return (
    CREDENTIAL_OPTIONS.find((option) => option.provider === provider)?.label ??
    provider
  );
}

function auditActionLabel(action: string): string {
  return action
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sessionUserAgentLabel(userAgent: string | null): string {
  if (userAgent == null || userAgent.trim().length === 0) return "Unknown device";
  const value = userAgent.toLowerCase();
  if (value.includes("iphone")) return "iPhone";
  if (value.includes("ipad")) return "iPad";
  if (value.includes("android")) return "Android";
  if (value.includes("mac os") || value.includes("macintosh")) return "Mac";
  if (value.includes("windows")) return "Windows";
  if (value.includes("linux")) return "Linux";
  return userAgent.slice(0, 72);
}

function ServerTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<ServerRole>("member");
  const [session, setSession] = useState<{
    username: string;
    displayName: string;
    role: ServerRole;
  } | null>(null);
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [usage, setUsage] = useState<ServerUsage | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [activeStreams, setActiveStreams] = useState<ActiveStreamSession[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RequestRecord[]>([]);
  const [sessions, setSessions] = useState<ServerSessionEntry[]>([]);
  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [auditEvents, setAuditEvents] = useState<ServerAuditEvent[]>([]);
  const [inviteDraft, setInviteDraft] = useState({
    label: "",
    role: "member" as Exclude<ServerRole, "owner">,
    simpleMode: true,
    maxUses: 1,
    expiresDays: 7,
  });
  const [createdInviteURL, setCreatedInviteURL] = useState<string | null>(null);
  const [newProfile, setNewProfile] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "member" as Exclude<ServerRole, "owner">,
    simpleMode: true,
  });
  const [passwordDraft, setPasswordDraft] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [effectiveCredentials, setEffectiveCredentials] = useState<EffectiveCredential[]>([]);
  const [profileCredential, setProfileCredential] = useState({
    provider: "real_debrid" as CredentialProvider,
    label: "Personal",
    value: "",
  });
  const [sharedCredential, setSharedCredential] = useState({
    provider: "tmdb" as CredentialProvider,
    label: "Shared",
    value: "",
  });
  // Which async save is in flight, so its submit button can disable + show
  // progress (prevents duplicate submissions / unclear final state).
  const [saving, setSaving] = useState<"password" | "credential" | null>(null);

  const canAdmin = role === "owner" || role === "admin";
  // A restricted profile can browse + watch but cannot perform management
  // actions (e.g. credential overrides). The server enforces this; hide the UI
  // so it isn't offered. Admin-only panels are already gated by canAdmin.
  const isRestricted = role === "restricted";

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await serverRequest<{
        session: {
          username: string;
          displayName: string;
          role: ServerRole;
        };
      }>("GET", "/api/auth/session");
      const admin =
        sessionResponse.session.role === "owner" ||
        sessionResponse.session.role === "admin";
      const [
        profilesResponse,
        usageResponse,
        healthResponse,
        activeStreamsResponse,
        requestsResponse,
        sessionsResponse,
        invitesResponse,
        credentialsResponse,
        auditResponse,
      ] = await Promise.all([
        serverRequest<{ profiles: ServerProfile[] }>("GET", "/api/profiles"),
        serverRequest<ServerUsage>(
          "GET",
          admin ? "/api/admin/usage/streams" : "/api/usage/streams",
        ),
        admin
          ? serverRequest<ServerHealth>("GET", "/api/admin/health")
          : Promise.resolve(null),
        admin
          ? serverRequest<{ streams: ActiveStreamSession[] }>(
              "GET",
              "/api/admin/streams/active",
            )
          : Promise.resolve({ streams: [] }),
        admin
          ? serverRequest<{ requests: RequestRecord[] }>(
              "GET",
              "/api/admin/requests?status=pending",
            )
          : Promise.resolve({ requests: [] }),
        serverRequest<{ sessions: ServerSessionEntry[] }>(
          "GET",
          "/api/auth/sessions",
        ),
        admin
          ? serverRequest<{ invites: ServerInvite[] }>("GET", "/api/admin/invites")
          : Promise.resolve({ invites: [] }),
        serverRequest<{ credentials: EffectiveCredential[] }>(
          "GET",
          "/api/credentials/effective",
        ),
        admin
          ? serverRequest<{ events: ServerAuditEvent[] }>(
              "GET",
              "/api/admin/audit-log?limit=25",
            )
          : Promise.resolve({ events: [] }),
      ]);
      setRole(sessionResponse.session.role);
      setSession(sessionResponse.session);
      setProfiles(profilesResponse.profiles);
      setUsage(usageResponse);
      setHealth(healthResponse);
      setActiveStreams(activeStreamsResponse.streams);
      setPendingRequests(requestsResponse.requests);
      setSessions(sessionsResponse.sessions);
      setInvites(invitesResponse.invites);
      setEffectiveCredentials(credentialsResponse.credentials);
      setAuditEvents(auditResponse.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProfile() {
    setMessage(null);
    setError(null);
    try {
      await serverRequest("POST", "/api/profiles", {
        username: newProfile.username,
        displayName: newProfile.displayName || newProfile.username,
        password: newProfile.password,
        role: newProfile.role,
        simpleMode: newProfile.simpleMode,
      });
      setNewProfile({
        username: "",
        displayName: "",
        password: "",
        role: "member",
        simpleMode: true,
      });
      setMessage("Profile created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveSharedCredential() {
    setMessage(null);
    setError(null);
    try {
      await serverRequest("PUT", "/api/admin/credentials", {
        provider: sharedCredential.provider,
        label: sharedCredential.label || "Shared",
        value: sharedCredential.value,
      });
      setSharedCredential((current) => ({ ...current, value: "" }));
      setMessage("Shared credential saved.");
      // Refresh so the credential-overrides list + health counts reflect the
      // new provider immediately (mirrors saveProfileCredential et al.).
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveProfileCredential() {
    if (saving != null) return;
    setMessage(null);
    setError(null);
    setSaving("credential");
    try {
      await serverRequest("PUT", "/api/profile/credentials", {
        provider: profileCredential.provider,
        label: profileCredential.label || "Personal",
        value: profileCredential.value,
      });
      setProfileCredential((current) => ({ ...current, value: "" }));
      setMessage("Profile credential override saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  async function changePassword() {
    if (saving != null) return;
    setMessage(null);
    setError(null);
    // Validate before flipping the saving flag so a mismatch shows instantly.
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setSaving("password");
    try {
      await serverRequest("POST", "/api/auth/change-password", {
        currentPassword: passwordDraft.currentPassword,
        newPassword: passwordDraft.newPassword,
      });
      setPasswordDraft({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage("Password changed. Other sessions were signed out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  async function revokeSession(id: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest(
        "DELETE",
        `/api/auth/sessions/${encodeURIComponent(id)}`,
      );
      setMessage("Session revoked.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function revokeStream(id: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest(
        "POST",
        `/api/admin/streams/${encodeURIComponent(id)}/revoke`,
      );
      setMessage("Stream terminated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function approveRequest(id: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest(
        "POST",
        `/api/admin/requests/${encodeURIComponent(id)}/approve`,
      );
      setMessage("Request approved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function denyRequest(id: string, reason?: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest(
        "POST",
        `/api/admin/requests/${encodeURIComponent(id)}/deny`,
        reason != null && reason.trim().length > 0 ? { reason } : undefined,
      );
      setMessage("Request denied.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteProfileCredential(id: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest(
        "DELETE",
        `/api/profile/credentials/${encodeURIComponent(id)}`,
      );
      setMessage("Profile credential override removed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createInvite() {
    setMessage(null);
    setError(null);
    setCreatedInviteURL(null);
    try {
      const response = await serverRequest<{
        invite: ServerInvite;
        token: string;
      }>("POST", "/api/admin/invites", {
        label: inviteDraft.label.trim() || undefined,
        role: inviteDraft.role,
        simpleMode: inviteDraft.simpleMode,
        maxUses: inviteDraft.maxUses,
        expiresInSeconds: inviteDraft.expiresDays * 24 * 60 * 60,
      });
      const baseURL = configuredServerURL() ?? window.location.origin;
      const inviteURL = new URL(baseURL);
      inviteURL.searchParams.set("invite", response.token);
      setCreatedInviteURL(inviteURL.toString());
      setInvites((current) => [response.invite, ...current]);
      setMessage("Invite link created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function revokeInvite(id: string) {
    setMessage(null);
    setError(null);
    try {
      await serverRequest("DELETE", `/api/admin/invites/${encodeURIComponent(id)}`);
      setMessage("Invite revoked.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyInviteURL() {
    if (createdInviteURL == null) return;
    setMessage(null);
    setError(null);
    try {
      await navigator.clipboard.writeText(createdInviteURL);
      setMessage("Invite link copied.");
    } catch {
      setError("Clipboard is unavailable in this session.");
    }
  }

  async function logout() {
    setMessage(null);
    setError(null);
    try {
      await serverRequest("POST", "/api/auth/logout");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return (
      <div
        className="settings-fields"
        aria-busy="true"
        aria-label="Loading server settings"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="settings-field" key={i} aria-hidden="true">
            <span className="settings-skel settings-skel-label" />
            <span className="settings-skel settings-skel-input" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="settings-fields">
      {error && <p className="settings-status is-error">{error}</p>}
      {message && <p className="settings-status">{message}</p>}

      <ServerConnectionPanel />

      <RemoteAccessPanel />

      {session != null && (
        <div className="settings-profile-row glass-rest">
          <div>
            <strong>{session.displayName}</strong>
            <span className="t-secondary"> @{session.username}</span>
          </div>
          <div className="settings-profile-meta t-secondary">
            <span>{session.role}</span>
            <button type="button" className="chip" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {canAdmin && health != null && <ServerHealthPanel health={health} />}

      {canAdmin && (
        <ActiveStreamsPanel streams={activeStreams} onRevoke={revokeStream} />
      )}

      {canAdmin && (
        <RequestQueuePanel
          requests={pendingRequests}
          onApprove={(id) => void approveRequest(id)}
          onDeny={(id, reason) => void denyRequest(id, reason)}
        />
      )}

      {usage != null && <ServerUsagePanel usage={usage} />}

      {canAdmin && <ServerAuditPanel events={auditEvents} />}

      <PasswordPanel
        draft={passwordDraft}
        onDraftChange={setPasswordDraft}
        onSave={() => void changePassword()}
        saving={saving === "password"}
      />

      <SessionsPanel
        sessions={sessions}
        onRevoke={(id) => void revokeSession(id)}
      />

      {!isRestricted && (
        <ProfileCredentialPanel
          credentials={effectiveCredentials}
          draft={profileCredential}
          onDraftChange={setProfileCredential}
          onSave={() => void saveProfileCredential()}
          onDelete={(id) => void deleteProfileCredential(id)}
          saving={saving === "credential"}
        />
      )}

      <div className="settings-sources-head">
        <span className="settings-sources-title">Profiles</span>
        <button type="button" className="chip" onClick={() => void refresh()}>
          <Icon name="refresh" size={13} /> Refresh
        </button>
      </div>

      <div className="settings-profile-list">
        {profiles.map((profile) => (
          <div key={profile.id} className="settings-profile-row glass-rest">
            <div>
              <strong>{profile.displayName}</strong>
              <span className="t-secondary">
                {profile.username ? ` @${profile.username}` : ""}
              </span>
            </div>
            <div className="settings-profile-meta t-secondary">
              <span>{profile.role}</span>
              {profile.simpleMode != null && (
                <span>{profile.simpleMode ? "Simple" : "Advanced"}</span>
              )}
              {profile.disabled && <span>Disabled</span>}
              {profile.self && <span>You</span>}
            </div>
          </div>
        ))}
      </div>

      {canAdmin && (
        <>
          <div className="settings-divider" />

          <KidsProfilesPanel />

          <div className="settings-source glass-rest">
            <div className="settings-sources-head">
              <span className="settings-sources-title">Invite link</span>
              <span className="chip">Profiles</span>
            </div>
            <div className="settings-source-row">
              <input
                type="text"
                value={inviteDraft.label}
                onChange={(event) =>
                  setInviteDraft((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="Label, e.g. Family"
              />
              <select
                value={inviteDraft.role}
                onChange={(event) =>
                  setInviteDraft((current) => ({
                    ...current,
                    role: event.target.value as Exclude<ServerRole, "owner">,
                  }))
                }
              >
                <option value="member">Member</option>
                <option value="restricted">Restricted</option>
                {role === "owner" && <option value="admin">Admin</option>}
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={inviteDraft.maxUses}
                onChange={(event) =>
                  setInviteDraft((current) => ({
                    ...current,
                    maxUses: Number(event.target.value) || 1,
                  }))
                }
                aria-label="Maximum uses"
              />
              <input
                type="number"
                min={1}
                max={30}
                value={inviteDraft.expiresDays}
                onChange={(event) =>
                  setInviteDraft((current) => ({
                    ...current,
                    expiresDays: Number(event.target.value) || 1,
                  }))
                }
                aria-label="Expires after days"
              />
              <label className="settings-source-active">
                <input
                  type="checkbox"
                  checked={inviteDraft.simpleMode}
                  onChange={(event) =>
                    setInviteDraft((current) => ({
                      ...current,
                      simpleMode: event.target.checked,
                    }))
                  }
                />
                Simple
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => void createInvite()}
              >
                Create invite
              </button>
            </div>
            {createdInviteURL != null && (
              <div className="settings-invite-link">
                <code>{createdInviteURL}</code>
                <button
                  type="button"
                  className="chip"
                  onClick={() => void copyInviteURL()}
                >
                  Copy
                </button>
              </div>
            )}
            {invites.length > 0 && (
              <div className="settings-usage-list">
                {invites.slice(0, 6).map((invite) => (
                  <div key={invite.id} className="settings-usage-row">
                    <span>
                      <strong>{invite.label ?? invite.role}</strong>
                      <span className="t-secondary">
                        {" "}
                        {invite.usedCount}/{invite.maxUses} used · expires{" "}
                        {formatShortDate(invite.expiresAt)}
                      </span>
                    </span>
                    <span className="settings-profile-meta t-secondary">
                      <span>{invite.active ? "Active" : "Inactive"}</span>
                      <span>{invite.simpleMode ? "Simple" : "Advanced"}</span>
                      {invite.active && (
                        <button
                          type="button"
                          className="chip"
                          onClick={() => void revokeInvite(invite.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-source glass-rest">
            <div className="settings-source-row">
              <input
                type="text"
                value={newProfile.username}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="Username"
              />
              <input
                type="text"
                value={newProfile.displayName}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Display name"
              />
            </div>
            <div className="settings-source-row">
              <input
                type="password"
                value={newProfile.password}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="Password"
              />
              <select
                value={newProfile.role}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    role: event.target.value as Exclude<ServerRole, "owner">,
                  }))
                }
              >
                <option value="member">Member</option>
                <option value="restricted">Restricted</option>
                {role === "owner" && <option value="admin">Admin</option>}
              </select>
              <label className="settings-source-active">
                <input
                  type="checkbox"
                  checked={newProfile.simpleMode}
                  onChange={(event) =>
                    setNewProfile((current) => ({
                      ...current,
                      simpleMode: event.target.checked,
                    }))
                  }
                />
                Simple
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => void createProfile()}
              >
                Create profile
              </button>
            </div>
          </div>

          <div className="settings-source glass-rest">
            <div className="settings-source-row">
              <select
                value={sharedCredential.provider}
                onChange={(event) =>
                  setSharedCredential((current) => ({
                    ...current,
                    provider: event.target.value as CredentialProvider,
                  }))
                }
              >
                {CREDENTIAL_OPTIONS.map((item) => (
                  <option key={item.provider} value={item.provider}>
                    {item.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={sharedCredential.label}
                onChange={(event) =>
                  setSharedCredential((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="Label"
              />
            </div>
            <div className="settings-source-row">
              <input
                type="password"
                value={sharedCredential.value}
                onChange={(event) =>
                  setSharedCredential((current) => ({
                    ...current,
                    value: event.target.value,
                  }))
                }
                placeholder="Token or API key"
              />
              <button
                type="button"
                className="btn"
                onClick={() => void saveSharedCredential()}
              >
                Save shared credential
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ServerAuditPanel({ events }: { events: ServerAuditEvent[] }) {
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Audit log</span>
        <span className="chip">Recent</span>
      </div>
      {events.length === 0 ? (
        <p className="settings-hint t-secondary">No recent audit events.</p>
      ) : (
        <div className="settings-usage-list">
          {events.map((event) => {
            const actor =
              event.actorDisplayName ?? event.actorUsername ?? "System";
            const target =
              event.targetType != null && event.targetId != null
                ? `${event.targetType}:${event.targetId}`
                : event.targetType ?? "server";
            return (
              <div key={event.id} className="settings-usage-row">
                <span>
                  <strong>{auditActionLabel(event.action)}</strong>
                  <span className="t-secondary"> by {actor}</span>
                </span>
                <span className="settings-profile-meta t-secondary">
                  <span>{target}</span>
                  <span>{formatShortDate(event.createdAt)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServerHealthPanel({ health }: { health: ServerHealth }) {
  const flags = [
    `Cookies ${health.config.cookieSecure ? "secure" : "not secure"}`,
    `SameSite ${health.config.cookieSameSite}`,
    health.config.trustProxy ? "Proxy trusted" : "Proxy not trusted",
    health.config.webDistConfigured ? "Hosted PWA ready" : "API only",
    health.config.rawStreamUrlsEnabled ? "Raw stream sessions on" : "Raw stream sessions off",
  ];

  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Server health</span>
        <span className={`chip${health.ok ? " is-active" : ""}`}>
          {health.ok ? "Online" : "Check"}
        </span>
      </div>

      <div className="settings-usage-grid">
        <div>
          <strong>{health.counts.users}</strong>
          <span className="t-secondary">Users</span>
        </div>
        <div>
          <strong>{health.counts.activeSessions}</strong>
          <span className="t-secondary">Active sessions</span>
        </div>
        <div>
          <strong>{health.counts.activeStreamSessions}</strong>
          <span className="t-secondary">Active streams</span>
        </div>
        <div>
          <strong>{health.counts.credentials}</strong>
          <span className="t-secondary">Credentials</span>
        </div>
        <div>
          <strong>{health.counts.activeInvites}</strong>
          <span className="t-secondary">Active invites</span>
        </div>
        <div>
          <strong>{health.counts.recentStreamErrors}</strong>
          <span className="t-secondary">24h stream errors</span>
        </div>
      </div>

      <div className="settings-url-list">
        {flags.map((flag) => (
          <span key={flag} className="chip">
            {flag}
          </span>
        ))}
      </div>

      {health.warnings.length > 0 && (
        <div className="settings-usage-list">
          {health.warnings.map((warning) => (
            <div key={warning} className="settings-usage-row">
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <p className="settings-hint t-secondary">
        Last checked {formatShortDate(health.serverTime)}
      </p>
    </div>
  );
}

function ActiveStreamsPanel({
  streams,
  onRevoke,
}: {
  streams: ActiveStreamSession[];
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Active streams</span>
        <span className="chip">{streams.length} active</span>
      </div>
      {streams.length === 0 ? (
        <p className="settings-hint t-secondary">No active stream sessions.</p>
      ) : (
        <div className="settings-usage-list">
          {streams.map((stream) => (
            <div key={stream.id} className="settings-usage-row">
              <span>
                <strong>{stream.title ?? "Stream session"}</strong>
                <span className="t-secondary">
                  {" "}
                  {stream.displayName} @{stream.username}
                </span>
              </span>
              <span className="settings-profile-meta t-secondary">
                <span>{formatBytes(stream.bytesServed)}</span>
                {stream.lastStatus != null && <span>HTTP {stream.lastStatus}</span>}
                {stream.lastError != null && <span>{stream.lastError}</span>}
                <span>
                  {stream.lastAccessedAt == null
                    ? `Started ${formatShortDate(stream.createdAt)}`
                    : `Last ${formatShortDate(stream.lastAccessedAt)}`}
                </span>
                <span>Expires {formatShortDate(stream.expiresAt)}</span>
                <button
                  type="button"
                  className="chip"
                  onClick={() => onRevoke(stream.id)}
                >
                  Terminate
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestQueuePanel({
  requests,
  onApprove,
  onDeny,
}: {
  requests: RequestRecord[];
  onApprove: (id: string) => void;
  onDeny: (id: string, reason?: string) => void;
}) {
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Title requests</span>
        <span className="chip">{requests.length} pending</span>
      </div>
      {requests.length === 0 ? (
        <p className="settings-hint t-secondary">No pending title requests.</p>
      ) : (
        <div className="settings-usage-list">
          {requests.map((request) => (
            <div key={request.id} className="settings-usage-row">
              <span>
                <strong>{request.preview.title}</strong>
                {request.preview.year != null && (
                  <span className="t-secondary"> ({request.preview.year})</span>
                )}
                <span className="t-secondary">
                  {" "}
                  — {request.requestedByDisplayName ?? "Someone"}
                </span>
              </span>
              <span className="settings-profile-meta t-secondary">
                <span>{formatShortDate(request.requestedAt)}</span>
                <button
                  type="button"
                  className="chip"
                  onClick={() => onApprove(request.id)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    const reason = window.prompt(
                      "Reason for denying (optional):",
                      "",
                    );
                    // Cancel leaves the request untouched; OK (even empty) denies.
                    if (reason == null) return;
                    onDeny(request.id, reason);
                  }}
                >
                  Deny
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PasswordPanel({
  draft,
  onDraftChange,
  onSave,
  saving,
}: {
  draft: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  };
  onDraftChange: Dispatch<
    SetStateAction<{
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    }>
  >;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Password</span>
        <span className="chip">Account</span>
      </div>
      <div className="settings-source-row">
        <input
          type="password"
          value={draft.currentPassword}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              currentPassword: event.target.value,
            }))
          }
          placeholder="Current password"
        />
      </div>
      <div className="settings-source-row">
        <input
          type="password"
          value={draft.newPassword}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              newPassword: event.target.value,
            }))
          }
          placeholder="New password"
        />
        <input
          type="password"
          value={draft.confirmPassword}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              confirmPassword: event.target.value,
            }))
          }
          placeholder="Confirm new password"
        />
        <button
          type="button"
          className="btn"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Changing…" : "Change password"}
        </button>
      </div>
    </div>
  );
}

// US movie certs the maturity cap offers, mildest → strongest (mirrors the
// server's MOVIE_CERTS enum). A kid profile is "watch this rating or milder".
const MATURITY_CERTS = ["G", "PG", "PG-13", "R", "NC-17"] as const;
const DEFAULT_MATURITY_CAP = "PG-13";

/** Admin-only control over the account's "who's watching" sub-profiles' kid
 *  mode + maturity cap. These are the household VIEWER profiles (the picker's
 *  list, /api/account/profiles), distinct from the login accounts above. The
 *  server strictly couples the two fields, so the UI always sends them together:
 *  kid ON + a chosen cap, or kid OFF + a null cap. */
function KidsProfilesPanel() {
  const [profiles, setProfiles] = useState<AccountProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const state = await fetchAccountProfiles();
      setProfiles(state.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save(
    id: string,
    body: { isKid: boolean; maturityMax: string | null },
  ) {
    setBusyId(id);
    setError(null);
    try {
      const res = await setProfileMaturity(id, body);
      setProfiles(res.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  // The default profile can't be a kid (it's the household's primary viewer); it
  // mirrors the picker, which never gates the default. Only non-default ones show.
  const manageable = profiles.filter((profile) => !profile.isDefault);

  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Kids profiles</span>
        <button type="button" className="chip" onClick={() => void refresh()}>
          <Icon name="refresh" size={13} /> Refresh
        </button>
      </div>
      <p className="settings-hint t-secondary">
        Kid mode locks a viewer profile to a curated, search-free experience and
        only allows titles at or below the chosen maturity cap. Leaving a kid
        profile then requires the account password.
      </p>

      {loading ? (
        <div
          className="settings-usage-list"
          aria-busy="true"
          aria-label="Loading profiles"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="settings-usage-row" key={i} aria-hidden="true">
              <span className="settings-skel settings-skel-name" />
              <span className="settings-skel settings-skel-pill" />
            </div>
          ))}
        </div>
      ) : manageable.length === 0 ? (
        <p className="settings-hint t-secondary">
          Add a viewer profile from the &ldquo;Who&rsquo;s watching?&rdquo; picker
          to set it up as a kids profile.
        </p>
      ) : (
        <div className="settings-usage-list">
          {manageable.map((profile) => {
            const busy = busyId === profile.id;
            // When kid mode is off there's no cap to show — default the picker to
            // PG-13 so turning it on has a sensible starting cap.
            const cap = profile.maturityMax ?? DEFAULT_MATURITY_CAP;
            return (
              <div key={profile.id} className="settings-usage-row">
                <span>
                  <strong>{profile.displayName}</strong>
                  {profile.isKid && (
                    <span className="t-secondary"> Kids · up to {profile.maturityMax}</span>
                  )}
                </span>
                <span className="settings-profile-meta">
                  <label className="settings-source-active">
                    <input
                      type="checkbox"
                      checked={profile.isKid}
                      disabled={busy}
                      onChange={(event) => {
                        // Enforce the server's coupling: kid ON needs a cap
                        // (default PG-13); kid OFF clears it to null.
                        if (event.target.checked) {
                          void save(profile.id, { isKid: true, maturityMax: cap });
                        } else {
                          void save(profile.id, { isKid: false, maturityMax: null });
                        }
                      }}
                    />
                    Kid mode
                  </label>
                  <select
                    value={cap}
                    disabled={busy || !profile.isKid}
                    aria-label={`Maturity cap for ${profile.displayName}`}
                    onChange={(event) =>
                      void save(profile.id, {
                        isKid: true,
                        maturityMax: event.target.value,
                      })
                    }
                  >
                    {MATURITY_CERTS.map((cert) => (
                      <option key={cert} value={cert}>
                        {cert}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error != null && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}

function SessionsPanel({
  sessions,
  onRevoke,
}: {
  sessions: ServerSessionEntry[];
  onRevoke: (id: string) => void;
}) {
  const activeSessions = sessions.filter((session) => session.active);
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Signed-in devices</span>
        <span className="chip">{activeSessions.length} active</span>
      </div>
      {sessions.length === 0 ? (
        <p className="settings-hint t-secondary">No sessions found.</p>
      ) : (
        <div className="settings-usage-list">
          {sessions.map((session) => (
            <div key={session.id} className="settings-usage-row">
              <span>
                <strong>{sessionUserAgentLabel(session.userAgent)}</strong>
                <span className="t-secondary">
                  {" "}
                  {session.current ? "Current session" : `Started ${formatShortDate(session.createdAt)}`}
                </span>
              </span>
              <span className="settings-profile-meta t-secondary">
                <span>
                  {session.active
                    ? `Expires ${formatShortDate(session.expiresAt)}`
                    : session.revokedAt != null
                      ? `Revoked ${formatShortDate(session.revokedAt)}`
                      : "Expired"}
                </span>
                {session.active && !session.current && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => onRevoke(session.id)}
                  >
                    Revoke
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCredentialPanel({
  credentials,
  draft,
  onDraftChange,
  onSave,
  onDelete,
  saving,
}: {
  credentials: EffectiveCredential[];
  draft: {
    provider: CredentialProvider;
    label: string;
    value: string;
  };
  onDraftChange: Dispatch<
    SetStateAction<{
      provider: CredentialProvider;
      label: string;
      value: string;
    }>
  >;
  onSave: () => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Credential overrides</span>
        <span className="chip">Profile</span>
      </div>
      <p className="settings-hint t-secondary">
        Your profile can use a personal API key or debrid token instead of the
        shared server default for the selected provider.
      </p>

      <div className="settings-source-row">
        <select
          value={draft.provider}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              provider: event.target.value as CredentialProvider,
            }))
          }
        >
          {CREDENTIAL_OPTIONS.map((item) => (
            <option key={item.provider} value={item.provider}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={draft.label}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              label: event.target.value,
            }))
          }
          placeholder="Label"
        />
      </div>
      <div className="settings-source-row">
        <input
          type="password"
          value={draft.value}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              value: event.target.value,
            }))
          }
          placeholder="Token or API key"
        />
        <button
          type="button"
          className="btn"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save profile override"}
        </button>
      </div>

      <div className="settings-usage-list">
        {credentials.map((credential) => (
          <div key={credential.provider} className="settings-usage-row">
            <span>
              <strong>{credentialProviderLabel(credential.provider)}</strong>
              <span className="t-secondary">
                {" "}
                {credential.label ?? "Not configured"}
              </span>
            </span>
            <span className="settings-profile-meta t-secondary">
              <span>
                {credential.scope === "profile"
                  ? "Profile override"
                  : credential.scope === "server"
                    ? "Shared server"
                    : "Missing"}
              </span>
              {credential.scope === "profile" && credential.id != null && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => onDelete(credential.id!)}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ServerUsagePanel({ usage }: { usage: ServerUsage }) {
  const topProfiles = usage.profiles?.slice(0, 6) ?? [];
  const recentSessions = usage.sessions?.slice(0, 6) ?? [];
  return (
    <div className="settings-source glass-rest">
      <div className="settings-sources-head">
        <span className="settings-sources-title">Stream forwarding</span>
        <span className="chip">{usage.days} days</span>
      </div>
      <div className="settings-usage-grid">
        <div>
          <strong>{formatBytes(usage.totalBytes)}</strong>
          <span className="t-secondary">Forwarded</span>
        </div>
        <div>
          <strong>{usage.streamCount}</strong>
          <span className="t-secondary">Stream sessions</span>
        </div>
        <div>
          <strong>{formatShortDate(usage.lastAccessedAt)}</strong>
          <span className="t-secondary">Last activity</span>
        </div>
      </div>

      {topProfiles.length > 0 && (
        <div className="settings-usage-list">
          {topProfiles.map((profile) => (
            <div key={profile.profileId} className="settings-usage-row">
              <span>
                <strong>{profile.displayName}</strong>
                <span className="t-secondary"> @{profile.username}</span>
              </span>
              <span className="t-secondary">
                {formatBytes(profile.totalBytes)} · {profile.streamCount} streams
              </span>
            </div>
          ))}
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="settings-usage-list">
          {recentSessions.map((session) => (
            <div key={session.id} className="settings-usage-row">
              <span>{session.title ?? "Stream session"}</span>
              <span className="t-secondary">
                {formatBytes(session.bytesServed)} · {formatShortDate(session.lastAccessedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AppearanceTab({
  draft,
  applyAppearance,
}: {
  draft: AppSettings;
  applyAppearance: (next: Partial<AppSettings>) => void;
}) {
  const selectedProfile =
    APPEARANCE_PROFILES.find((profile) => appearanceProfileMatches(draft, profile)) ??
    null;
  const selectedProfileId = selectedProfile?.id ?? CUSTOM_APPEARANCE_PROFILE;
  const currentTheme = THEMES.find((theme) => theme.id === draft.theme) ?? THEMES[0];
  const currentAccent =
    ACCENTS.find((accent) => accent.id === draft.appearanceAccent) ?? ACCENTS[0];
  // Smart preloading is a per-device preference (localStorage), not a synced
  // AppSettings field — toggled here with local mirror state.
  const [smartPreload, setSmartPreload] = useState(isSmartPreloadEnabled());

  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        Tune the interface for the device and room you are using. Appearance
        changes apply instantly and are saved to this profile.
      </p>

      <div className="appearance-profile-card settings-source glass-rest">
        <div className="appearance-profile-head">
          <div>
            <span className="settings-label">Quick profile</span>
            <p className="settings-hint t-secondary">
              Apply a complete interface setup, then fine tune each control below.
            </p>
          </div>
          <label className="appearance-profile-picker">
            <span className="settings-secret-label">Profile</span>
            <select
              value={selectedProfileId}
              onChange={(event) => {
                const profile = APPEARANCE_PROFILES.find(
                  (item) => item.id === event.target.value,
                );
                if (profile) applyAppearance(profile.settings);
              }}
            >
              {selectedProfile == null && (
                <option value={CUSTOM_APPEARANCE_PROFILE}>Custom current</option>
              )}
              {APPEARANCE_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="appearance-profile-summary">
          {selectedProfile?.description ??
            "Custom mix saved from the fine-tune controls below."}
        </div>
        <div className="appearance-current-chips" aria-label="Current appearance summary">
          <span>{currentTheme.label}</span>
          <span>
            {currentAccent.id === "theme"
              ? "Theme accent"
              : `${currentAccent.label} accent`}
          </span>
          <span>
            {draft.appearanceDensity === "compact" ? "Compact spacing" : "Roomy spacing"}
          </span>
          <span>
            {draft.appearanceTextSize === "s"
              ? "Small type"
              : draft.appearanceTextSize === "l"
                ? "Large type"
                : "Medium type"}
          </span>
          <span>
            {draft.appearanceBlur <= 12
              ? "Crisp depth"
              : draft.appearanceBlur >= 18
                ? "Soft depth"
                : "Balanced depth"}
          </span>
          <span>
            {draft.appearanceChrome === "solid"
              ? "Solid panels"
              : draft.appearanceChrome === "translucent"
                ? "Translucent panels"
                : "Balanced panels"}
          </span>
          <span>
            {draft.appearanceBackdrop === "plain"
              ? "Plain backdrop"
              : draft.appearanceBackdrop === "subtle"
                ? "Subtle glow"
                : "Ambient glow"}
          </span>
          <span>
            {draft.appearanceHeroScale === "compact"
              ? "Compact hero"
              : draft.appearanceHeroScale === "cinematic"
                ? "Cinematic hero"
                : "Balanced hero"}
          </span>
          <span>
            {draft.appearancePanelContrast === "high"
              ? "High contrast"
              : draft.appearancePanelContrast === "soft"
                ? "Soft contrast"
                : "Balanced contrast"}
          </span>
          <span>
            {draft.appearanceNavLabels === "icons"
              ? "Icon nav"
              : draft.appearanceNavLabels === "labels"
                ? "Labeled nav"
                : "Adaptive nav"}
          </span>
          <span>
            {draft.appearanceNavTint === "airy"
              ? "Airy dock"
              : draft.appearanceNavTint === "solid"
                ? "Solid dock"
                : "Balanced dock"}
          </span>
          <span>
            {draft.appearancePosterSize === "compact"
              ? "Compact posters"
              : draft.appearancePosterSize === "large"
                ? "Large posters"
                : "Medium posters"}
          </span>
        </div>
      </div>

      <div className="appearance-section-head">
        <div>
          <span className="settings-sources-title">Display</span>
          <p className="settings-hint t-secondary">
            Device-scale defaults come first; switch only the dimensions that need it.
          </p>
        </div>
      </div>

      <div className="settings-control-grid">
        <SegmentedControl
          label="Density"
          value={draft.appearanceDensity}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceDensity: value as AppearanceDensity })
          }
        />
        <SegmentedControl
          label="Text size"
          value={draft.appearanceTextSize}
          options={[
            { value: "s", label: "S" },
            { value: "m", label: "M" },
            { value: "l", label: "L" },
            { value: "xl", label: "XL" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceTextSize: value as AppearanceTextSize })
          }
        />
        <SegmentedControl
          label="Motion"
          value={draft.appearanceMotion}
          options={[
            { value: "system", label: "System" },
            { value: "normal", label: "Normal" },
            { value: "reduced", label: "Reduced" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceMotion: value as AppearanceMotion })
          }
        />
        <SegmentedControl
          label="Corners"
          value={draft.appearanceRadius}
          options={[
            { value: "sharp", label: "Sharp" },
            { value: "default", label: "Default" },
            { value: "round", label: "Round" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceRadius: value as AppearanceRadius })
          }
        />
        <SegmentedControl
          label="Glass depth"
          value={draft.appearanceChrome}
          options={[
            { value: "translucent", label: "Light" },
            { value: "balanced", label: "Balanced" },
            { value: "solid", label: "Solid" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceChrome: value as AppearanceChrome })
          }
        />
        <SegmentedControl
          label="Backdrop"
          value={draft.appearanceBackdrop}
          options={[
            { value: "ambient", label: "Ambient" },
            { value: "subtle", label: "Subtle" },
            { value: "plain", label: "Plain" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceBackdrop: value as AppearanceBackdrop })
          }
        />
        <SegmentedControl
          label="Hero scale"
          value={draft.appearanceHeroScale}
          options={[
            { value: "compact", label: "Compact" },
            { value: "standard", label: "Standard" },
            { value: "cinematic", label: "Cinema" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceHeroScale: value as AppearanceHeroScale })
          }
        />
        <SegmentedControl
          label="Panel contrast"
          value={draft.appearancePanelContrast}
          options={[
            { value: "soft", label: "Soft" },
            { value: "standard", label: "Standard" },
            { value: "high", label: "High" },
          ]}
          onChange={(value) =>
            applyAppearance({
              appearancePanelContrast: value as AppearancePanelContrast,
            })
          }
        />
      </div>

      <div className="appearance-section-head">
        <div>
          <span className="settings-sources-title">Navigation and catalog</span>
          <p className="settings-hint t-secondary">
            Tune the dock, rail labels, and poster density for the screen in use.
          </p>
        </div>
      </div>

      <div className="settings-control-grid">
        <SegmentedControl
          label="Nav labels"
          value={draft.appearanceNavLabels}
          options={[
            { value: "auto", label: "Auto" },
            { value: "labels", label: "Labels" },
            { value: "icons", label: "Icons" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceNavLabels: value as AppearanceNavLabels })
          }
        />
        <SegmentedControl
          label="Dock tint"
          value={draft.appearanceNavTint}
          options={[
            { value: "airy", label: "Airy" },
            { value: "balanced", label: "Balanced" },
            { value: "solid", label: "Solid" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceNavTint: value as AppearanceNavTint })
          }
        />
        <SegmentedControl
          label="Poster size"
          value={draft.appearancePosterSize}
          options={[
            { value: "compact", label: "Compact" },
            { value: "default", label: "Default" },
            { value: "large", label: "Large" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearancePosterSize: value as AppearancePosterSize })
          }
        />
      </div>

      <div className="settings-source glass-rest">
        <div className="settings-sources-head">
          <span className="settings-sources-title">Accent</span>
          <span className="settings-hint t-secondary">Default follows preset</span>
        </div>
        <div className="accent-grid" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((accent) => {
            const active = draft.appearanceAccent === accent.id;
            return (
              <button
                key={accent.id}
                type="button"
                className={`accent-swatch${active ? " is-active" : ""}`}
                style={{ "--accent-preview": accent.color } as CSSProperties}
                onClick={() =>
                  applyAppearance({ appearanceAccent: accent.id as AppearanceAccent })
                }
                role="radio"
                aria-checked={active}
                aria-label={`${accent.label} accent`}
              >
                <span />
                {accent.label}
              </button>
            );
          })}
        </div>
      </div>

      <Field
        label="Glass blur"
        hint="Lower values make surfaces more solid; higher values make the app feel more frosted."
      >
        <div className="settings-range-shell">
          <div className="settings-range-control">
            <input
              type="range"
              min={6}
              max={28}
              step={2}
              value={draft.appearanceBlur}
              onChange={(event) =>
                applyAppearance({ appearanceBlur: Number(event.target.value) })
              }
              aria-label="Glass blur"
            />
            <output aria-live="polite">{draft.appearanceBlur}px</output>
          </div>
          <div className="settings-range-labels" aria-hidden="true">
            <span>Solid</span>
            <span>Frosted</span>
          </div>
        </div>
      </Field>

      <div className="settings-divider" />

      <div className="settings-sources-head">
        <span className="settings-sources-title">Presets</span>
        <span className="settings-hint t-secondary">One-click theme presets</span>
      </div>
      <div className="theme-grid">
        {THEMES.map((t) => {
          const active = t.id === draft.theme;
          return (
            <button
              key={t.id}
              type="button"
              className={`theme-card${active ? " is-active" : ""}`}
              onClick={() => applyAppearance({ theme: t.id })}
              aria-pressed={active}
            >
              <span
                className="theme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${t.swatchBg[0]}, ${t.swatchBg[1]})`,
                }}
              >
                <span
                  className="theme-swatch-dot"
                  style={{ background: t.swatchAccent }}
                />
                {active && (
                  <span className="theme-swatch-check">
                    <Icon name="check" size={13} />
                  </span>
                )}
              </span>
              <span className="theme-card-label">{t.label}</span>
              <span className="theme-card-desc t-secondary">{t.description}</span>
              <span className={`theme-card-status${active ? " is-active" : ""}`}>
                {active ? "Selected" : "Preset"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="settings-extras">
        <span className="settings-sources-title">Extras</span>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={smartPreload}
            onChange={(e) => {
              setSmartPreloadEnabled(e.target.checked);
              setSmartPreload(e.target.checked);
            }}
          />
          <span>
            <strong>Smart preloading</strong>
            <span className="settings-hint t-secondary">
              Quietly warms upcoming screens and images so the app feels instant.
              Turn off on a metered connection to save data.
            </span>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.showWatchStats}
            onChange={(e) => applyAppearance({ showWatchStats: e.target.checked })}
          />
          <span>
            <strong>Show watch stats</strong>
            <span className="settings-hint t-secondary">
              Adds a personal insights card (time watched, completion, streak,
              favourite genres) to the top of the History screen.
            </span>
          </span>
        </label>
        <button
          type="button"
          className="btn settings-replay-tour"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("ds:open-welcome-guide"))
          }
        >
          <Icon name="sparkles" size={15} />
          Replay welcome guide
        </button>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-segment-block">
      <span className="settings-label">{label}</span>
      <div
        className="settings-segmented"
        role="radiogroup"
        aria-label={label}
        data-option-count={options.length}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const AI_MODEL_OPTIONS: Record<AppSettings["aiProvider"], string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"],
  ollama: ["llama3.2", "qwen2.5", "mistral"],
};

function modelOptions(provider: AppSettings["aiProvider"], current: string): string[] {
  const base = AI_MODEL_OPTIONS[provider] ?? [];
  return current.trim().length > 0 && !base.includes(current)
    ? [current, ...base]
    : base;
}

function KeysTab({ draft, patch }: TabProps) {
  const [keyPanel, setKeyPanel] = useState<"catalog" | "assistant">("catalog");
  const keyPanels: Array<{
    id: "catalog" | "assistant";
    label: string;
    summary: string;
  }> = [
    {
      id: "catalog",
      label: "Catalog metadata",
      summary: "Search, posters, ratings",
    },
    {
      id: "assistant",
      label: "Assistant AI",
      summary: "Mood discovery and chat",
    },
  ];

  return (
    <div className="settings-fields">
      <p className="settings-hint settings-secret-summary">
        Secrets stay in this profile. Desktop builds keep them in secure device
        storage when available.
      </p>

      <div className="settings-subsection-picker is-option-only">
        <label className="settings-subsection-select settings-mobile-picker">
          <span>Credential group</span>
          <select
            value={keyPanel}
            onChange={(event) =>
              setKeyPanel(event.target.value as "catalog" | "assistant")
            }
          >
            {keyPanels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.label}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-option-strip" aria-label="Credential group">
          {keyPanels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={`settings-option-card${keyPanel === panel.id ? " is-active" : ""}`}
              onClick={() => setKeyPanel(panel.id)}
              aria-pressed={keyPanel === panel.id}
            >
              <span>{panel.label}</span>
              <small>{panel.summary}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-key-grid is-single">
        {keyPanel === "catalog" && (
          <section className="settings-key-card glass-rest" aria-label="Catalog metadata credentials">
            <Field label="TMDB API key" hint="Powers Discover, Search, and Detail metadata.">
              <SecretInput
                value={draft.tmdbKey}
                onChange={(e) => patch({ tmdbKey: e.target.value })}
                placeholder="v3 API key"
              />
            </Field>

            {/* OMDB is optional enrichment on top of TMDB — an Advanced extra. */}
            <AdvancedOnly>
              <Field label="OMDB API key" hint="Optional IMDb / Rotten Tomatoes enrichment.">
                <SecretInput
                  value={draft.omdbKey}
                  onChange={(e) => patch({ omdbKey: e.target.value })}
                  placeholder="OMDB key"
                />
              </Field>
            </AdvancedOnly>

            <Field
              label="OpenSubtitles API key"
              hint="Enables in-player subtitle search and download."
            >
              <SecretInput
                value={draft.openSubtitlesApiKey}
                onChange={(e) => patch({ openSubtitlesApiKey: e.target.value })}
                placeholder="OpenSubtitles key"
              />
            </Field>
          </section>
        )}

        {keyPanel === "assistant" && (
          <section className="settings-key-card glass-rest" aria-label="Assistant AI credentials">
            <div className="settings-key-provider-grid">
              <Field label="AI provider" hint="Provider default is selected first.">
                <select
                  value={draft.aiProvider}
                  onChange={(e) =>
                    patch({ aiProvider: e.target.value as AppSettings["aiProvider"] })
                  }
                >
                  {AIProviderKind.allCases().map((k) => (
                    <option key={k} value={k}>
                      {AIProviderKind.displayName(k)}
                    </option>
                  ))}
                </select>
              </Field>

              {/* The explicit model override is an Advanced dial — Simple mode
                  sticks with the recommended provider default. */}
              <AdvancedOnly>
                <Field label="Model" hint="Recommended default stays first.">
                  <select
                    value={draft.aiModel.trim().length === 0 ? "__default" : draft.aiModel}
                    onChange={(event) =>
                      patch({
                        aiModel:
                          event.target.value === "__default" ? "" : event.target.value,
                      })
                    }
                  >
                    <option value="__default">Provider default (recommended)</option>
                    {modelOptions(draft.aiProvider, draft.aiModel).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </Field>
              </AdvancedOnly>
            </div>

            {draft.aiProvider === "ollama" ? (
              <Field label="Ollama endpoint" hint="A local Ollama server URL.">
                <input
                  type="text"
                  value={draft.ollamaEndpoint}
                  onChange={(e) => patch({ ollamaEndpoint: e.target.value })}
                  placeholder="http://localhost:11434"
                />
              </Field>
            ) : (
              <Field label={`${AIProviderKind.displayName(draft.aiProvider)} API key`}>
                <SecretInput
                  value={draft.aiApiKey}
                  onChange={(e) => patch({ aiApiKey: e.target.value })}
                  placeholder="API key"
                />
              </Field>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
  label,
  note = "",
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  label?: string;
  note?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setMessage(null);
    onChange(event);
  }

  async function copySecret() {
    if (value.trim().length === 0) {
      setMessage("Nothing to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied.");
    } catch {
      setMessage("Clipboard unavailable.");
    }
  }

  const cleanedNote = note.trim();
  const showNote = cleanedNote.length > 0 || message != null;

  return (
    <div className="settings-secret-wrap">
      {label != null && label.trim().length > 0 && (
        <span className="settings-secret-label">{label}</span>
      )}
      <div className="settings-secret">
        <input
          type={revealed ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="settings-secret-actions">
          <button
            type="button"
            className="settings-secret-btn"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide secret" : "Reveal secret"}
            title={revealed ? "Hide" : "Reveal"}
          >
            <Icon name={revealed ? "eye-off" : "eye"} size={15} />
          </button>
          <button
            type="button"
            className="settings-secret-btn"
            onClick={() => void copySecret()}
            aria-label="Copy secret"
            title="Copy"
          >
            <Icon name="copy" size={15} />
          </button>
        </div>
      </div>
      {showNote && (
        <div className="settings-secret-note">
          {cleanedNote.length > 0 && <span>{cleanedNote}</span>}
          {message != null && <strong>{message}</strong>}
        </div>
      )}
    </div>
  );
}

function DebridTab({ draft, patch }: TabProps) {
  const serviceOptions = DebridServiceType.allCases();
  const [selectedService, setSelectedService] = useState<
    AppSettings["debridTokens"][number]["service"]
  >(serviceOptions[0]);

  function tokenFor(service: AppSettings["debridTokens"][number]["service"]) {
    return draft.debridTokens.find((t) => t.service === service)?.apiToken ?? "";
  }
  function setToken(
    service: AppSettings["debridTokens"][number]["service"],
    token: string,
  ) {
    const exists = draft.debridTokens.some((t) => t.service === service);
    let next: AppSettings["debridTokens"];
    if (token.trim().length === 0) {
      // Clearing → drop the entry, preserving the order of the rest.
      next = draft.debridTokens.filter((t) => t.service !== service);
    } else if (exists) {
      // Update IN PLACE. Array order is provider priority (saveSettingsToStore
      // assigns priority by index), so filter+re-append would silently demote an
      // edited provider to last and change which service is preferred.
      next = draft.debridTokens.map((t) =>
        t.service === service ? { ...t, apiToken: token } : t,
      );
    } else {
      next = [...draft.debridTokens, { service, apiToken: token }];
    }
    patch({ debridTokens: next });
  }

  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        Choose one provider at a time. Saved providers are tried in priority
        order; the first that has a cached result wins. Tokens stay in this
        profile, with secure device storage in desktop builds when available.
      </p>

      <Field label="Provider" hint="Real-Debrid is selected first by default.">
        <select
          value={selectedService}
          onChange={(event) =>
            setSelectedService(
              event.target.value as AppSettings["debridTokens"][number]["service"],
            )
          }
        >
          {serviceOptions.map((service) => (
            <option key={service} value={service}>
              {DebridServiceType.displayName(service)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={`${DebridServiceType.displayName(selectedService)} token`}
        hint="Paste the API token for this provider."
      >
        <SecretInput
          value={tokenFor(selectedService)}
          onChange={(e) => setToken(selectedService, e.target.value)}
          placeholder="API token"
        />
      </Field>

      {draft.debridTokens.length > 0 && (
        <div className="settings-url-list">
          {draft.debridTokens.map((token, index) => (
            <button
              key={token.service}
              type="button"
              className="chip"
              onClick={() => setSelectedService(token.service)}
            >
              {index + 1}. {DebridServiceType.displayName(token.service)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesTab({ draft, patch }: TabProps) {
  const [selectedPresetId, setSelectedPresetId] = useState(SOURCE_PRESETS[0].id);

  function addSource() {
    const preset = sourcePreset(selectedPresetId);
    const entry: SourceEntry = {
      id: `src-${Date.now()}`,
      type: preset.type,
      baseURL: preset.baseURL,
      apiKey: "",
      isActive: true,
      displayName: preset.displayName,
      priority: draft.sources.length,
    };
    patch({ sources: [...draft.sources, entry] });
  }
  function updateSource(id: string, next: Partial<SourceEntry>) {
    patch({
      sources: draft.sources.map((s) => (s.id === id ? { ...s, ...next } : s)),
    });
  }
  function removeSource(id: string) {
    patch({ sources: draft.sources.filter((s) => s.id !== id) });
  }
  /** Reorder a source (priority = list order, lower index = higher priority). */
  function moveSource(id: string, delta: number) {
    const idx = draft.sources.findIndex((s) => s.id === id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= draft.sources.length) return;
    const reordered = [...draft.sources];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(next, 0, moved);
    patch({ sources: reordered.map((s, i) => ({ ...s, priority: i })) });
  }
  function changeSourceType(source: SourceEntry, type: StoredIndexerType) {
    const preset = defaultSourcePreset(type);
    updateSource(source.id, {
      type,
      baseURL: preset.baseURL,
      displayName:
        source.displayName != null && source.displayName.trim().length > 0
          ? source.displayName
          : preset.displayName,
    });
  }

  return (
    <div className="settings-fields">
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.builtInIndexersEnabled}
          onChange={(e) => patch({ builtInIndexersEnabled: e.target.checked })}
        />
        <span>
          <strong>Built-in scrapers</strong>
          <span className="settings-built-in-list t-secondary">
            APIBay, YTS, EZTV
          </span>
          <span className="settings-pill">No setup needed</span>
        </span>
      </label>

      <div className="settings-divider" />

      <div className="settings-sources-head">
        <span className="settings-sources-title">External indexers</span>
        <div className="settings-add-source">
          <select
            value={selectedPresetId}
            onChange={(event) => setSelectedPresetId(event.target.value)}
            aria-label="Source preset"
          >
            {SOURCE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-prominent settings-add-source-btn"
            onClick={addSource}
          >
            <Icon name="check" size={13} /> Add source
          </button>
        </div>
      </div>

      {draft.sources.length === 0 ? (
        <p className="settings-hint t-secondary">
          No external indexers. The built-in scrapers cover most titles.
        </p>
      ) : (
        draft.sources.map((s, i) => {
          const choices = sourceURLChoices(s.type, s.baseURL);
          const urlSelectValue = choices.some((choice) => choice.value === s.baseURL)
            ? s.baseURL
            : CUSTOM_SOURCE_URL;
          const selectedChoice = choices.find((choice) => choice.value === s.baseURL);
          const preset = defaultSourcePreset(s.type);

          return (
            <div key={s.id} className="settings-source glass-rest">
              <div className="settings-source-row">
                <div className="settings-source-main">
                  <label className="settings-source-control settings-source-type-control">
                    <span>Protocol</span>
                    <select
                      className="settings-source-type-select"
                      value={s.type}
                      onChange={(e) =>
                        changeSourceType(s, e.target.value as SourceEntry["type"])
                      }
                    >
                      {SOURCE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {sourceTypeLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-source-control settings-source-name-control">
                    <span>Indexer name</span>
                    <input
                      type="text"
                      className="settings-source-name"
                      value={s.displayName ?? ""}
                      onChange={(e) =>
                        updateSource(s.id, { displayName: e.target.value })
                      }
                      placeholder="Display name"
                    />
                  </label>
                </div>
                <div className="settings-source-actions">
                  <label className="settings-source-active">
                    <input
                      type="checkbox"
                      checked={s.isActive}
                      onChange={(e) =>
                        updateSource(s.id, { isActive: e.target.checked })
                      }
                    />
                    Enabled
                  </label>
                  <div className="settings-source-button-group">
                    <button
                      type="button"
                      className="settings-source-remove"
                      onClick={() => moveSource(s.id, -1)}
                      aria-label="Move source up"
                      title="Move up"
                      disabled={i === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="settings-source-remove"
                      onClick={() => moveSource(s.id, 1)}
                      aria-label="Move source down"
                      title="Move down"
                      disabled={i === draft.sources.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="settings-source-remove"
                      onClick={() => removeSource(s.id)}
                      aria-label="Remove source"
                    >
                      <Icon name="xmark" size={15} />
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={`settings-source-url-line${
                  urlSelectValue === CUSTOM_SOURCE_URL ? " has-custom" : ""
                }`}
              >
                <label className="settings-source-control">
                  <span>URL preset</span>
                  <select
                    className="settings-source-url-select"
                    value={urlSelectValue}
                    onChange={(event) => {
                      if (event.target.value !== CUSTOM_SOURCE_URL) {
                        updateSource(s.id, { baseURL: event.target.value });
                      }
                    }}
                  >
                    {choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                    <option value={CUSTOM_SOURCE_URL}>Custom URL</option>
                  </select>
                </label>
                {urlSelectValue === CUSTOM_SOURCE_URL && (
                  <label className="settings-source-control">
                    <span>Custom URL</span>
                    <input
                      type="url"
                      className="settings-source-url-input"
                      value={s.baseURL}
                      onChange={(e) =>
                        updateSource(s.id, { baseURL: e.target.value })
                      }
                      placeholder="https://indexer.example.com"
                    />
                  </label>
                )}
              </div>

              <p className="settings-source-meta">
                {selectedChoice?.label ?? "Custom URL"} · {preset.note}
              </p>
              <SecretInput
                value={s.apiKey ?? ""}
                onChange={(e) => updateSource(s.id, { apiKey: e.target.value })}
                label="API key"
                placeholder="API key (if required)"
                note="Saved only for this external indexer source."
              />
            </div>
          );
        })
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {hint && <span className="settings-field-hint t-secondary">{hint}</span>}
      {children}
    </label>
  );
}
