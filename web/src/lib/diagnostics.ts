import type { AppSettings } from "../data/settings";

export type DiagnosticArea =
  | "app"
  | "catalog"
  | "download"
  | "network"
  | "player"
  | "provider"
  | "storage"
  | "update";
export type DiagnosticLevel = "info" | "warning" | "error";

export interface DiagnosticEvent {
  at: string;
  area: DiagnosticArea;
  code: string;
  level: DiagnosticLevel;
  detail?: string;
}

export interface DiagnosticsContext {
  appVersion: string;
  runtime: "desktop" | "browser";
  platform: string;
  serverMode: boolean;
  settings: AppSettings;
}

const MAX_EVENTS = 100;
const events: DiagnosticEvent[] = [];

const SECRET_ASSIGNMENT =
  /\b(token|apikey|api_key|key|secret|password|authorization)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_QUERY =
  /([?&](?:token|apikey|api_key|key|secret|password|authorization)=)[^&#\s]+/gi;
const LONG_CREDENTIAL = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Remove credential-shaped values before an event can enter a support file. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(BEARER_TOKEN, "Bearer [redacted]")
    .replace(SENSITIVE_QUERY, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .replace(LONG_CREDENTIAL, "[redacted]")
    .slice(0, 500);
}

export function recordDiagnostic(
  area: DiagnosticArea,
  code: string,
  level: DiagnosticLevel = "info",
  detail?: string,
): void {
  events.push({
    at: new Date().toISOString(),
    area,
    code: code.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80),
    level,
    ...(detail == null || detail.length === 0
      ? {}
      : { detail: redactDiagnosticText(detail) }),
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function recentDiagnostics(): DiagnosticEvent[] {
  return events.map((event) => ({ ...event }));
}

export function clearDiagnostics(): void {
  events.length = 0;
}

export function buildDiagnosticsReport(context: DiagnosticsContext) {
  const { settings } = context;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: "YAWF Stream",
    appVersion: context.appVersion,
    environment: {
      runtime: context.runtime,
      platform: context.platform,
      mode: context.serverMode ? "server" : "local",
    },
    configuration: {
      networkMode: settings.networkMode,
      dataSaver: settings.dataSaver,
      builtInPlayer: settings.builtInPlayer,
      autoAdvanceEpisodes: settings.autoAdvanceEpisodes,
      configuredProviders: settings.debridTokens
        .filter((entry) => entry.apiToken.trim().length > 0)
        .map((entry) => entry.service),
      activeSourceTypes: settings.sources
        .filter((source) => source.isActive)
        .map((source) => source.type),
      builtInIndexersEnabled: settings.builtInIndexersEnabled,
      tmdbConfigured: settings.tmdbKey.trim().length > 0,
      omdbConfigured: settings.omdbKey.trim().length > 0,
      subtitlesConfigured: settings.openSubtitlesApiKey.trim().length > 0,
      traktConfigured: settings.traktClientId.trim().length > 0,
    },
    events: recentDiagnostics(),
  };
}

export function downloadDiagnosticsReport(report: unknown): void {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `yawf-stream-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
