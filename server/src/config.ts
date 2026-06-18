import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { normalizeSecretKey } from "./crypto.js";
import type { CookieSameSite, ServerConfig } from "./types.js";

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sameSiteEnv(name: string, fallback: CookieSameSite): CookieSameSite {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "lax" || value === "strict" || value === "none") return value;
  return fallback;
}

function loadOrCreateSecretKey(dataDir: string): Buffer {
  const envSecret = process.env.DS_SERVER_SECRET_KEY;
  if (envSecret && envSecret.trim().length > 0) {
    return normalizeSecretKey(envSecret);
  }

  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "server.key");
  if (existsSync(path)) {
    return normalizeSecretKey(readFileSync(path, "utf8"));
  }

  const generated = randomBytes(32).toString("base64");
  writeFileSync(path, generated, { mode: 0o600 });
  return normalizeSecretKey(generated);
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir =
    overrides.dataDir ??
    process.env.DS_SERVER_DATA_DIR ??
    join(process.cwd(), "data");
  const databasePath =
    overrides.databasePath ??
    process.env.DS_SERVER_DB_PATH ??
    join(dataDir, "debridstreamer.sqlite");

  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: overrides.port ?? numberEnv("PORT", 43110),
    dataDir,
    databasePath,
    webDistPath:
      overrides.webDistPath ??
      (process.env.DS_WEB_DIST != null && process.env.DS_WEB_DIST.trim().length > 0
        ? resolve(process.env.DS_WEB_DIST)
        : null),
    secretKey: overrides.secretKey ?? loadOrCreateSecretKey(dataDir),
    cookieSecure:
      overrides.cookieSecure ?? boolEnv("DS_SERVER_COOKIE_SECURE", process.env.NODE_ENV === "production"),
    cookieSameSite:
      overrides.cookieSameSite ?? sameSiteEnv("DS_SERVER_COOKIE_SAMESITE", "lax"),
    sessionTtlSeconds:
      overrides.sessionTtlSeconds ?? numberEnv("DS_SERVER_SESSION_TTL_SECONDS", 60 * 60 * 24 * 30),
    allowRawStreamUrls:
      overrides.allowRawStreamUrls ??
      boolEnv("DS_SERVER_ALLOW_RAW_STREAM_URLS", process.env.NODE_ENV !== "production"),
    trustProxy: overrides.trustProxy ?? boolEnv("DS_SERVER_TRUST_PROXY", false),
    corsOrigin: overrides.corsOrigin ?? process.env.DS_SERVER_CORS_ORIGIN ?? null,
    logger: overrides.logger ?? boolEnv("DS_SERVER_LOGGER", process.env.NODE_ENV === "production"),
  };
}
