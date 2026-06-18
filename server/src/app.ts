import { Readable, Transform } from "node:stream";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import cookie from "@fastify/cookie";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z, type ZodType } from "zod";
import { AppDatabase } from "./db.js";
import { loadConfig } from "./config.js";
// The media adapter is plain JS so the server compiler does not typecheck the
// browser service graph; esbuild bundles it and tests cover the runtime route.
// @ts-ignore JS module intentionally has no declaration file.
import {
  resolveServerStream,
  searchServerStreams,
} from "./media-runtime.js";
import {
  discoverServerMedia,
  getServerCategory,
  getServerDetail,
  getServerDiscoverHome,
  getServerGenres,
  getServerUpcomingEpisodes,
  searchServerMedia,
} from "./metadata-runtime.js";
import {
  addSecondsISO,
  decryptSecret,
  encryptSecret,
  hashOptional,
  hashPassword,
  nowISO,
  randomId,
  randomToken,
  sha256,
  verifyPassword,
} from "./crypto.js";
import {
  CREDENTIAL_PROVIDERS,
  type AuthContext,
  type BuildAppOptions,
  type CredentialProvider,
  type ServerConfig,
  type UserRole,
} from "./types.js";

const SESSION_COOKIE = "ds_session";
const CSRF_COOKIE = "ds_csrf";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);

const passwordSchema = z.string().min(8).max(512);
const roleSchema = z.enum(["owner", "admin", "member", "restricted"]);
const providerSchema = z.enum(CREDENTIAL_PROVIDERS);
const mediaTypeSchema = z.enum(["movie", "series"]);
const debridServiceSchema = z.enum([
  "real_debrid",
  "all_debrid",
  "premiumize",
  "torbox",
]);

const setupOwnerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(512),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: passwordSchema,
});

const createProfileSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
  role: roleSchema.exclude(["owner"]).default("member"),
  simpleMode: z.boolean().default(true),
});

const createInviteSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.exclude(["owner"]).default("member"),
  simpleMode: z.boolean().default(true),
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().min(32).max(256),
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100).optional(),
});

const patchProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  simpleMode: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const watchlistBodySchema = z.object({
  preview: z.unknown(),
});

const historyBodySchema = z.object({
  episodeId: z.string().trim().min(1).max(128).nullable().optional(),
  progressSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive().nullable().optional(),
  completed: z.boolean().default(false),
  streamQuality: z.string().trim().max(80).nullable().optional(),
  preview: z.unknown(),
  lastWatched: z.string().datetime().optional(),
});

const credentialBodySchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  provider: providerSchema,
  label: z.string().trim().min(1).max(120).default("Default"),
  value: z.string().min(1).max(8192),
  priority: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

const rawStreamSessionSchema = z.object({
  upstreamUrl: z.string().url(),
  contentType: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  expiresInSeconds: z.number().int().min(1).max(60 * 60 * 24).default(60 * 60 * 6),
});

const streamUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const sessionIdParamSchema = z.string().trim().min(1).max(120);

const streamSearchQuerySchema = z.object({
  type: mediaTypeSchema.default("movie"),
  season: z.coerce.number().int().min(0).max(10_000).optional(),
  episode: z.coerce.number().int().min(0).max(10_000).optional(),
});

const mediaSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.union([mediaTypeSchema, z.literal("all")]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const mediaCategorySchema = z.enum([
  "trending",
  "popular",
  "top_rated",
  "now_playing",
  "upcoming",
  "airing_today",
  "on_the_air",
]);

const mediaCategoryQuerySchema = z.object({
  type: mediaTypeSchema,
  category: mediaCategorySchema,
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const mediaGenresQuerySchema = z.object({
  type: mediaTypeSchema,
});

const mediaDiscoverBaseQuerySchema = z.object({
  type: mediaTypeSchema,
});

const mediaDetailQuerySchema = z.object({
  id: z.string().trim().min(1).max(128),
  type: mediaTypeSchema,
});

const mediaPreviewSchema = z.object({
  id: z.string().trim().min(1).max(128),
  type: mediaTypeSchema,
  title: z.string().trim().min(1).max(300),
  year: z.number().int().nullable().optional(),
  posterPath: z.string().nullable().optional(),
  imdbRating: z.number().nullable().optional(),
  tmdbId: z.number().int().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
});

const upcomingEpisodesBodySchema = z.object({
  series: z.array(mediaPreviewSchema).max(200),
});

type MediaPreviewInput = z.infer<typeof mediaPreviewSchema>;
type SeriesPreviewInput = MediaPreviewInput & { type: "series" };

function isSeriesPreviewInput(input: MediaPreviewInput): input is SeriesPreviewInput {
  return input.type === "series";
}

const resolveStreamSchema = z.object({
  infoHash: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{40}$/)
    .transform((value) => value.toLowerCase()),
  preferredService: debridServiceSchema.nullable().optional(),
  expiresInSeconds: z.number().int().min(1).max(60 * 60 * 24).default(60 * 60 * 6),
});

const profileSettingSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().max(16_384).nullable(),
});

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function createRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (
    request: FastifyRequest,
    bucket: string,
    limit: number,
    windowMs: number,
  ): void => {
    const now = Date.now();
    const key = `${bucket}:${request.ip}`;
    const current = buckets.get(key);
    if (current == null || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw httpError(429, "Too many requests. Try again shortly.");
    }
  };
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function stringQueryParams(
  query: Record<string, unknown>,
  excluded: Set<string>,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (excluded.has(key)) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value == null) continue;
    params[key] = String(value);
  }
  return params;
}

function isAdmin(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

function cookieOptions(config: ServerConfig, httpOnly: boolean) {
  return {
    path: "/",
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    httpOnly,
    maxAge: config.sessionTtlSeconds,
  };
}

function serializePreview(preview: unknown): string {
  return JSON.stringify(preview ?? null);
}

function deserializePreview(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function userCount(db: AppDatabase): number {
  return (db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
}

function audit(
  db: AppDatabase,
  auth: Pick<AuthContext, "userId" | "profileId"> | null,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: unknown,
): void {
  db.sqlite
    .prepare(
      `INSERT INTO audit_log
       (id, actor_user_id, actor_profile_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomId("audit"),
      auth?.userId ?? null,
      auth?.profileId ?? null,
      action,
      targetType ?? null,
      targetId ?? null,
      metadata == null ? null : JSON.stringify(metadata),
      nowISO(),
    );
}

function createUserAndProfile(
  db: AppDatabase,
  input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: UserRole;
    simpleMode?: boolean;
  },
): { userId: string; profileId: string } {
  const userId = randomId("user");
  const profileId = randomId("profile");
  const now = nowISO();
  db.sqlite
    .prepare(
      `INSERT INTO users
       (id, username, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, input.username, input.displayName, input.passwordHash, input.role, now);
  db.sqlite
    .prepare(
      `INSERT INTO profiles
       (id, user_id, display_name, simple_mode, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      profileId,
      userId,
      input.displayName,
      input.simpleMode ?? true ? 1 : 0,
      now,
      now,
    );
  return { userId, profileId };
}

function mapInviteRow(row: {
  id: string;
  label: string | null;
  role: UserRole;
  simple_mode: number;
  max_uses: number;
  used_count: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}) {
  return {
    id: row.id,
    label: row.label,
    role: row.role,
    simpleMode: row.simple_mode === 1,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    active:
      row.revoked_at == null &&
      row.used_count < row.max_uses &&
      new Date(row.expires_at).getTime() > Date.now(),
  };
}

function mapAuditLogRow(row: {
  id: string;
  actor_user_id: string | null;
  actor_profile_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string | null;
  created_at: string;
}) {
  let metadata: unknown = null;
  if (row.metadata_json != null) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorProfileId: row.actor_profile_id,
    actorUsername: row.actor_username,
    actorDisplayName: row.actor_display_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata,
    createdAt: row.created_at,
  };
}

function mapSessionRow(
  row: {
    id: string;
    user_agent: string | null;
    ip_hash: string | null;
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
  },
  currentSessionId: string,
) {
  return {
    id: row.id,
    userAgent: row.user_agent,
    ipHash: row.ip_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    current: row.id === currentSessionId,
    active:
      row.revoked_at == null &&
      new Date(row.expires_at).getTime() > Date.now(),
  };
}

function createSession(
  db: AppDatabase,
  config: ServerConfig,
  userId: string,
  request: FastifyRequest,
): { sessionId: string; rawToken: string; csrfToken: string; expiresAt: string } {
  const sessionId = randomId("sess");
  const rawToken = randomToken();
  const csrfToken = randomToken(24);
  const expiresAt = addSecondsISO(config.sessionTtlSeconds);
  db.sqlite
    .prepare(
      `INSERT INTO sessions
       (id, user_id, token_hash, user_agent, ip_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      userId,
      sha256(rawToken),
      request.headers["user-agent"] ?? null,
      hashOptional(request.ip),
      nowISO(),
      expiresAt,
    );
  db.sqlite
    .prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .run(nowISO(), userId);
  return { sessionId, rawToken, csrfToken, expiresAt };
}

function setSessionCookies(
  reply: FastifyReply,
  config: ServerConfig,
  session: { sessionId: string; rawToken: string; csrfToken: string },
): void {
  reply.setCookie(
    SESSION_COOKIE,
    `${session.sessionId}.${session.rawToken}`,
    cookieOptions(config, true),
  );
  reply.setCookie(CSRF_COOKIE, session.csrfToken, cookieOptions(config, false));
}

function clearSessionCookies(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(config, true));
  reply.clearCookie(CSRF_COOKIE, cookieOptions(config, false));
}

function readSessionCookie(request: FastifyRequest): { sessionId: string; rawToken: string } | null {
  const value = request.cookies?.[SESSION_COOKIE];
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  return {
    sessionId: value.slice(0, dot),
    rawToken: value.slice(dot + 1),
  };
}

function readAuth(db: AppDatabase, request: FastifyRequest): AuthContext | null {
  const cookieValue = readSessionCookie(request);
  if (cookieValue == null) return null;
  const row = db.sqlite
    .prepare(
      `SELECT
         users.id AS userId,
         users.username AS username,
         users.role AS role,
         profiles.id AS profileId,
         profiles.display_name AS displayName,
         sessions.id AS sessionId
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       JOIN profiles ON profiles.user_id = users.id AND profiles.is_default = 1
       WHERE sessions.id = ?
         AND sessions.token_hash = ?
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > ?
         AND users.disabled_at IS NULL
         AND profiles.disabled_at IS NULL
       LIMIT 1`,
    )
    .get(cookieValue.sessionId, sha256(cookieValue.rawToken), nowISO()) as
    | AuthContext
    | undefined;
  return row ?? null;
}

function requireAuth(db: AppDatabase, request: FastifyRequest): AuthContext {
  const auth = readAuth(db, request);
  if (auth == null) throw httpError(401, "Authentication required.");
  return auth;
}

function requireAdmin(auth: AuthContext): void {
  if (!isAdmin(auth.role)) throw httpError(403, "Admin access required.");
}

function requireCsrf(request: FastifyRequest): void {
  if (!unsafeMethods.has(request.method)) return;
  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.headers["x-csrf-token"];
  const supplied = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (!cookieToken || !supplied || supplied !== cookieToken) {
    throw httpError(403, "CSRF token is missing or invalid.");
  }
}

function allowedCorsOrigin(origin: string | undefined, config: ServerConfig): string | null {
  if (origin == null || origin.length === 0) return null;
  if (config.corsOrigin != null && config.corsOrigin.trim().length > 0) {
    const allowed = config.corsOrigin.split(",").map((item) => item.trim());
    return allowed.includes(origin) ? origin : null;
  }
  if (process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(origin);
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        return origin;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function redactedCredential(row: {
  id: string;
  provider: CredentialProvider;
  scope: "server" | "profile";
  profile_id: string | null;
  label: string;
  priority: number;
  is_active: number;
  updated_at: string;
}) {
  return {
    id: row.id,
    provider: row.provider,
    scope: row.scope,
    profileId: row.profile_id,
    label: row.label,
    priority: row.priority,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at,
  };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".wasm": "application/wasm",
};

function safeStaticPath(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0] ?? "/");
  const clean = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = resolve(join(root, clean === "/" ? "index.html" : clean));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function registerStaticApp(app: FastifyInstance, config: ServerConfig): void {
  if (config.webDistPath == null || !existsSync(config.webDistPath)) return;
  const root = resolve(config.webDistPath);

  app.get("/server-mode.js", async (_request, reply) => {
    reply.header("content-type", "text/javascript; charset=utf-8");
    reply.header("cache-control", "no-store");
    return reply.send(
      "globalThis.__DEBRIDSTREAMER_SERVER_URL__ = globalThis.location.origin;\n",
    );
  });

  app.get("/*", async (request, reply) => {
    const path = (request.params as { "*": string })["*"] ?? "";
    if (path.startsWith("api/")) throw httpError(404, "Not found.");

    const candidate = safeStaticPath(root, `/${path}`);
    const file =
      candidate != null && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(root, "index.html");

    const ext = extname(file);
    reply.header("content-type", MIME_TYPES[ext] ?? "application/octet-stream");
    if (ext === ".html") {
      reply.header("cache-control", "no-store");
    } else {
      reply.header("cache-control", "public, max-age=31536000, immutable");
    }
    return reply.send(createReadStream(file));
  });
}

function effectiveCredentials(db: AppDatabase, profileId: string) {
  return CREDENTIAL_PROVIDERS.map((provider) => {
    const row = db.sqlite
      .prepare(
        `SELECT id, provider, scope, profile_id, label, priority, is_active, updated_at
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
      .get(provider, profileId) as Parameters<typeof redactedCredential>[0] | undefined;
    return row ? redactedCredential(row) : { provider, scope: null, id: null, label: null };
  });
}

function upsertCredential(
  db: AppDatabase,
  config: ServerConfig,
  input: z.infer<typeof credentialBodySchema>,
  scope: "server" | "profile",
  profileId: string | null,
): ReturnType<typeof redactedCredential> {
  const now = nowISO();
  const id = input.id ?? randomId("cred");
  const existing = db.sqlite
    .prepare(
      `SELECT id, scope, profile_id
       FROM credential_secrets
       WHERE id = ?`,
    )
    .get(id) as { id: string; scope: string; profile_id: string | null } | undefined;

  if (existing != null && (existing.scope !== scope || existing.profile_id !== profileId)) {
    throw httpError(404, "Credential not found.");
  }

  const encryptedValue = encryptSecret(input.value, config.secretKey);
  if (existing == null) {
    db.sqlite
      .prepare(
        `INSERT INTO credential_secrets
         (id, provider, scope, profile_id, label, encrypted_value, priority, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        scope,
        profileId,
        input.label,
        encryptedValue,
        input.priority,
        input.isActive ? 1 : 0,
        now,
        now,
      );
  } else {
    db.sqlite
      .prepare(
        `UPDATE credential_secrets
         SET provider = ?,
             label = ?,
             encrypted_value = ?,
             priority = ?,
             is_active = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.provider,
        input.label,
        encryptedValue,
        input.priority,
        input.isActive ? 1 : 0,
        now,
        id,
      );
  }

  const row = db.sqlite
    .prepare(
      `SELECT id, provider, scope, profile_id, label, priority, is_active, updated_at
       FROM credential_secrets
       WHERE id = ?`,
    )
    .get(id) as Parameters<typeof redactedCredential>[0];
  return redactedCredential(row);
}

function mapWatchHistoryRow(row: {
  media_id: string;
  episode_id: string | null;
  progress_seconds: number;
  duration_seconds: number | null;
  completed: number;
  last_watched: string;
  stream_quality: string | null;
  preview_json: string;
}) {
  return {
    mediaId: row.media_id,
    episodeId: row.episode_id,
    progressSeconds: row.progress_seconds,
    durationSeconds: row.duration_seconds,
    completed: row.completed === 1,
    lastWatched: row.last_watched,
    streamQuality: row.stream_quality,
    preview: deserializePreview(row.preview_json),
  };
}

function createStreamSession(
  db: AppDatabase,
  config: ServerConfig,
  auth: AuthContext,
  input: {
    upstreamUrl: string;
    contentType?: string | null;
    title?: string | null;
    expiresInSeconds: number;
  },
) {
  const id = randomId("stream");
  const createdAt = nowISO();
  const expiresAt = addSecondsISO(input.expiresInSeconds);
  db.sqlite
    .prepare(
      `INSERT INTO stream_sessions
       (id, profile_id, encrypted_upstream_url, content_type, title, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      auth.profileId,
      encryptSecret(input.upstreamUrl, config.secretKey),
      input.contentType ?? null,
      input.title ?? null,
      createdAt,
      expiresAt,
    );
  return {
    id,
    playbackUrl: `/api/stream/${id}`,
    expiresAt,
  };
}

function usageSinceISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function recordStreamTransfer(
  db: AppDatabase,
  input: {
    sessionId: string;
    profileId: string;
    bytes: number;
    status: number;
    completed: boolean;
    error?: string | null;
  },
): void {
  const now = nowISO();
  db.sqlite
    .prepare(
      `UPDATE stream_sessions
       SET bytes_served = bytes_served + ?,
           last_accessed_at = ?,
           completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END,
           last_status = ?,
           last_error = ?
       WHERE id = ? AND profile_id = ?`,
    )
    .run(
      input.bytes,
      now,
      input.completed ? 1 : 0,
      now,
      input.status,
      input.error ?? null,
      input.sessionId,
      input.profileId,
    );
}

function countedStream(
  db: AppDatabase,
  input: {
    sessionId: string;
    profileId: string;
    status: number;
    body: ReadableStream<Uint8Array>;
  },
) {
  let bytes = 0;
  let recorded = false;
  const source = Readable.fromWeb(input.body);
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });

  function record(completed: boolean, error?: Error | null) {
    if (recorded) return;
    recorded = true;
    recordStreamTransfer(db, {
      sessionId: input.sessionId,
      profileId: input.profileId,
      bytes,
      status: input.status,
      completed,
      error: error?.message ?? null,
    });
  }

  source.once("error", (error) => record(false, error));
  counter.once("error", (error) => record(false, error));
  counter.once("finish", () => record(true));
  counter.once("close", () => record(false));
  return source.pipe(counter);
}

function streamUsageSummary(db: AppDatabase, profileId: string, days: number) {
  const since = usageSinceISO(days);
  const summary = db.sqlite
    .prepare(
      `SELECT COUNT(*) AS stream_count,
              COALESCE(SUM(bytes_served), 0) AS total_bytes,
              MAX(last_accessed_at) AS last_accessed_at
       FROM stream_sessions
       WHERE profile_id = ? AND created_at >= ?`,
    )
    .get(profileId, since) as {
    stream_count: number;
    total_bytes: number;
    last_accessed_at: string | null;
  };
  const sessions = db.sqlite
    .prepare(
      `SELECT id, title, created_at, expires_at, bytes_served,
              last_accessed_at, completed_at, last_status
       FROM stream_sessions
       WHERE profile_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all(profileId, since) as Array<{
    id: string;
    title: string | null;
    created_at: string;
    expires_at: string;
    bytes_served: number;
    last_accessed_at: string | null;
    completed_at: string | null;
    last_status: number | null;
  }>;
  return {
    days,
    totalBytes: summary.total_bytes,
    streamCount: summary.stream_count,
    lastAccessedAt: summary.last_accessed_at,
    sessions: sessions.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      bytesServed: row.bytes_served,
      lastAccessedAt: row.last_accessed_at,
      completedAt: row.completed_at,
      lastStatus: row.last_status,
    })),
  };
}

function adminStreamUsageSummary(db: AppDatabase, days: number) {
  const since = usageSinceISO(days);
  const rows = db.sqlite
    .prepare(
      `SELECT profiles.id AS profile_id,
              users.username,
              profiles.display_name,
              users.role,
              COUNT(stream_sessions.id) AS stream_count,
              COALESCE(SUM(stream_sessions.bytes_served), 0) AS total_bytes,
              MAX(stream_sessions.last_accessed_at) AS last_accessed_at
       FROM profiles
       JOIN users ON users.id = profiles.user_id
       LEFT JOIN stream_sessions
         ON stream_sessions.profile_id = profiles.id
        AND stream_sessions.created_at >= ?
       WHERE profiles.disabled_at IS NULL
       GROUP BY profiles.id
       ORDER BY total_bytes DESC, stream_count DESC, profiles.display_name ASC`,
    )
    .all(since) as Array<{
    profile_id: string;
    username: string;
    display_name: string;
    role: UserRole;
    stream_count: number;
    total_bytes: number;
    last_accessed_at: string | null;
  }>;
  const totalBytes = rows.reduce((sum, row) => sum + row.total_bytes, 0);
  const streamCount = rows.reduce((sum, row) => sum + row.stream_count, 0);
  const lastAccessedAt =
    rows
      .map((row) => row.last_accessed_at)
      .filter((value): value is string => value != null)
      .sort()
      .at(-1) ?? null;
  return {
    days,
    totalBytes,
    streamCount,
    lastAccessedAt,
    profiles: rows.map((row) => ({
      profileId: row.profile_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      totalBytes: row.total_bytes,
      streamCount: row.stream_count,
      lastAccessedAt: row.last_accessed_at,
    })),
  };
}

function adminActiveStreamSessions(db: AppDatabase) {
  const now = nowISO();
  const rows = db.sqlite
    .prepare(
      `SELECT stream_sessions.id,
              stream_sessions.profile_id,
              users.username,
              profiles.display_name,
              stream_sessions.title,
              stream_sessions.content_type,
              stream_sessions.created_at,
              stream_sessions.expires_at,
              stream_sessions.bytes_served,
              stream_sessions.last_accessed_at,
              stream_sessions.last_status,
              stream_sessions.last_error
       FROM stream_sessions
       JOIN profiles ON profiles.id = stream_sessions.profile_id
       JOIN users ON users.id = profiles.user_id
       WHERE stream_sessions.revoked_at IS NULL
         AND stream_sessions.expires_at > ?
         AND stream_sessions.completed_at IS NULL
       ORDER BY
         COALESCE(stream_sessions.last_accessed_at, stream_sessions.created_at) DESC
       LIMIT 100`,
    )
    .all(now) as Array<{
    id: string;
    profile_id: string;
    username: string;
    display_name: string;
    title: string | null;
    content_type: string | null;
    created_at: string;
    expires_at: string;
    bytes_served: number;
    last_accessed_at: string | null;
    last_status: number | null;
    last_error: string | null;
  }>;

  return {
    streams: rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      username: row.username,
      displayName: row.display_name,
      title: row.title,
      contentType: row.content_type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      bytesServed: row.bytes_served,
      lastAccessedAt: row.last_accessed_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
    })),
  };
}

type SqlParam = string | number | bigint | Buffer | null;

function countScalar(db: AppDatabase, sql: string, ...params: SqlParam[]): number {
  const row = db.sqlite.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function adminHealthSummary(db: AppDatabase, config: ServerConfig) {
  const now = nowISO();
  const counts = {
    users: countScalar(db, "SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL"),
    profiles: countScalar(db, "SELECT COUNT(*) AS count FROM profiles WHERE disabled_at IS NULL"),
    activeSessions: countScalar(
      db,
      `SELECT COUNT(*) AS count
       FROM sessions
       WHERE revoked_at IS NULL AND expires_at > ?`,
      now,
    ),
    activeStreamSessions: countScalar(
      db,
      `SELECT COUNT(*) AS count
       FROM stream_sessions
       WHERE revoked_at IS NULL
         AND expires_at > ?
         AND completed_at IS NULL`,
      now,
    ),
    credentials: countScalar(
      db,
      "SELECT COUNT(*) AS count FROM credential_secrets WHERE is_active = 1",
    ),
    activeInvites: countScalar(
      db,
      `SELECT COUNT(*) AS count
       FROM invites
       WHERE revoked_at IS NULL
         AND expires_at > ?
         AND used_count < max_uses`,
      now,
    ),
    auditEvents: countScalar(db, "SELECT COUNT(*) AS count FROM audit_log"),
    recentStreamErrors: countScalar(
      db,
      `SELECT COUNT(*) AS count
       FROM stream_sessions
       WHERE last_error IS NOT NULL
         AND created_at >= ?`,
      addSecondsISO(-60 * 60 * 24),
    ),
  };

  const warnings: string[] = [];
  if (!config.cookieSecure) {
    warnings.push("Secure cookies are disabled. Use HTTPS and DS_SERVER_COOKIE_SECURE=true before exposing outside a private network.");
  }
  if (config.allowRawStreamUrls) {
    warnings.push("Raw stream URL sessions are enabled. Keep this disabled for public deployments.");
  }
  if (!config.trustProxy) {
    warnings.push("Reverse-proxy trust is disabled. Enable DS_SERVER_TRUST_PROXY=true behind a trusted HTTPS proxy.");
  }
  if (config.webDistPath == null) {
    warnings.push("Hosted PWA assets are not configured; API-only mode is active.");
  }

  return {
    ok: true,
    serverTime: now,
    setupRequired: userCount(db) === 0,
    counts,
    config: {
      cookieSecure: config.cookieSecure,
      cookieSameSite: config.cookieSameSite,
      trustProxy: config.trustProxy,
      corsConfigured: config.corsOrigin != null && config.corsOrigin.trim().length > 0,
      rawStreamUrlsEnabled: config.allowRawStreamUrls,
      webDistConfigured: config.webDistPath != null,
      sessionTtlSeconds: config.sessionTtlSeconds,
    },
    warnings,
  };
}

function streamContentType(fileName: string): string | null {
  const ext = extname(fileName.toLowerCase());
  return MIME_TYPES[ext] ?? null;
}

function registerRoutes(app: FastifyInstance, db: AppDatabase, config: ServerConfig): void {
  const rateLimit = createRateLimiter();

  app.get("/api/health", async () => ({
    ok: true,
    setupRequired: userCount(db) === 0,
  }));

  app.get("/api/bootstrap", async (request) => {
    const auth = readAuth(db, request);
    return {
      setupRequired: userCount(db) === 0,
      session: auth,
    };
  });

  app.get("/api/admin/health", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    return adminHealthSummary(db, config);
  });

  app.post("/api/auth/setup-owner", async (request, reply) => {
    const body = parseBody(setupOwnerSchema, request.body);
    rateLimit(request, "auth:setup-owner", 5, 15 * 60 * 1000);
    if (userCount(db) > 0) throw httpError(409, "Owner account already exists.");
    const passwordHash = await hashPassword(body.password);

    const created = db.transaction(() => {
      const ids = createUserAndProfile(db, {
        username: body.username,
        displayName: body.displayName,
        passwordHash,
        role: "owner",
        simpleMode: false,
      });
      audit(db, { userId: ids.userId, profileId: ids.profileId }, "auth.setup_owner", "user", ids.userId);
      return ids;
    });

    const session = createSession(db, config, created.userId, request);
    setSessionCookies(reply, config, session);
    return {
      user: {
        id: created.userId,
        username: body.username,
        displayName: body.displayName,
        role: "owner",
      },
      profile: {
        id: created.profileId,
        displayName: body.displayName,
      },
      csrfToken: session.csrfToken,
    };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    rateLimit(
      request,
      `auth:login:${body.username.toLowerCase()}`,
      10,
      15 * 60 * 1000,
    );
    const row = db.sqlite
      .prepare(
        `SELECT id, username, display_name, password_hash, role
         FROM users
         WHERE username = ? AND disabled_at IS NULL`,
      )
      .get(body.username) as
      | {
          id: string;
          username: string;
          display_name: string;
          password_hash: string;
          role: UserRole;
        }
      | undefined;

    if (row == null || !(await verifyPassword(row.password_hash, body.password))) {
      throw httpError(401, "Invalid username or password.");
    }

    const profile = db.sqlite
      .prepare(
        `SELECT id, display_name
         FROM profiles
         WHERE user_id = ? AND is_default = 1 AND disabled_at IS NULL
         LIMIT 1`,
      )
      .get(row.id) as { id: string; display_name: string } | undefined;
    if (profile == null) throw httpError(403, "Profile is disabled.");

    const session = createSession(db, config, row.id, request);
    audit(db, { userId: row.id, profileId: profile.id }, "auth.login", "user", row.id);
    setSessionCookies(reply, config, session);
    return {
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
      },
      profile: {
        id: profile.id,
        displayName: profile.display_name,
      },
      csrfToken: session.csrfToken,
    };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    const body = parseBody(acceptInviteSchema, request.body);
    rateLimit(request, `auth:invite:${sha256(body.token)}`, 8, 15 * 60 * 1000);
    if (userCount(db) === 0) throw httpError(409, "Create the owner account first.");
    const tokenHash = sha256(body.token);
    const invite = db.sqlite
      .prepare(
        `SELECT id, role, simple_mode, max_uses, used_count, expires_at, revoked_at
         FROM invites
         WHERE token_hash = ?
         LIMIT 1`,
      )
      .get(tokenHash) as
      | {
          id: string;
          role: Exclude<UserRole, "owner">;
          simple_mode: number;
          max_uses: number;
          used_count: number;
          expires_at: string;
          revoked_at: string | null;
        }
      | undefined;
    if (invite == null) throw httpError(404, "Invite not found.");
    if (invite.revoked_at != null) throw httpError(410, "Invite has been revoked.");
    if (invite.used_count >= invite.max_uses) throw httpError(410, "Invite has already been used.");
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      throw httpError(410, "Invite has expired.");
    }

    const passwordHash = await hashPassword(body.password);
    const created = db.transaction(() => {
      const fresh = db.sqlite
        .prepare(
          `SELECT used_count, max_uses, revoked_at, expires_at
           FROM invites
           WHERE id = ?
           LIMIT 1`,
        )
        .get(invite.id) as
        | {
            used_count: number;
            max_uses: number;
            revoked_at: string | null;
            expires_at: string;
          }
        | undefined;
      if (
        fresh == null ||
        fresh.revoked_at != null ||
        fresh.used_count >= fresh.max_uses ||
        new Date(fresh.expires_at).getTime() <= Date.now()
      ) {
        throw httpError(410, "Invite is no longer available.");
      }
      const userProfile = createUserAndProfile(db, {
        username: body.username,
        displayName: body.displayName ?? body.username,
        passwordHash,
        role: invite.role,
        simpleMode: invite.simple_mode === 1,
      });
      db.sqlite
        .prepare("UPDATE invites SET used_count = used_count + 1 WHERE id = ?")
        .run(invite.id);
      return userProfile;
    });

    const session = createSession(db, config, created.userId, request);
    audit(db, created, "auth.invite.accept", "invite", invite.id);
    setSessionCookies(reply, config, session);
    return {
      user: {
        id: created.userId,
        username: body.username,
        displayName: body.displayName ?? body.username,
        role: invite.role,
      },
      profile: {
        id: created.profileId,
        displayName: body.displayName ?? body.username,
      },
      csrfToken: session.csrfToken,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookieValue = readSessionCookie(request);
    if (cookieValue != null) {
      db.sqlite
        .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND token_hash = ?")
        .run(nowISO(), cookieValue.sessionId, sha256(cookieValue.rawToken));
    }
    clearSessionCookies(reply, config);
    return { ok: true };
  });

  app.get("/api/auth/session", async (request) => {
    const auth = requireAuth(db, request);
    return { session: auth };
  });

  app.get("/api/auth/sessions", async (request) => {
    const auth = requireAuth(db, request);
    const rows = db.sqlite
      .prepare(
        `SELECT id, user_agent, ip_hash, created_at, expires_at, revoked_at
         FROM sessions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(auth.userId) as Array<Parameters<typeof mapSessionRow>[0]>;
    return {
      sessions: rows.map((row) => mapSessionRow(row, auth.sessionId)),
    };
  });

  app.delete("/api/auth/sessions/:id", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const id = sessionIdParamSchema.parse((request.params as { id: string }).id);
    db.sqlite
      .prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE id = ?
           AND user_id = ?
           AND revoked_at IS NULL`,
      )
      .run(nowISO(), id, auth.userId);
    audit(db, auth, "auth.session.revoke", "session", id, {
      current: id === auth.sessionId,
    });
    return { ok: true };
  });

  app.post("/api/auth/change-password", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const body = parseBody(changePasswordSchema, request.body);
    const row = db.sqlite
      .prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1")
      .get(auth.userId) as { password_hash: string } | undefined;
    if (row == null || !(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw httpError(401, "Current password is incorrect.");
    }
    const nextHash = await hashPassword(body.newPassword);
    const now = nowISO();
    db.transaction(() => {
      db.sqlite
        .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(nextHash, auth.userId);
      db.sqlite
        .prepare(
          `UPDATE sessions
           SET revoked_at = ?
           WHERE user_id = ?
             AND id <> ?
             AND revoked_at IS NULL`,
        )
        .run(now, auth.userId, auth.sessionId);
      audit(db, auth, "auth.password.change", "user", auth.userId);
    });
    return { ok: true };
  });

  app.get("/api/settings/profile", async (request) => {
    const auth = requireAuth(db, request);
    const rows = db.sqlite
      .prepare(
        `SELECT key, value
         FROM profile_settings
         WHERE profile_id = ?
         ORDER BY key ASC`,
      )
      .all(auth.profileId) as Array<{ key: string; value: string }>;
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    return { settings };
  });

  app.put("/api/settings/profile", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const body = parseBody(profileSettingSchema, request.body);
    if (body.value == null) {
      db.sqlite
        .prepare("DELETE FROM profile_settings WHERE profile_id = ? AND key = ?")
        .run(auth.profileId, body.key);
    } else {
      db.sqlite
        .prepare(
          `INSERT INTO profile_settings (profile_id, key, value)
           VALUES (?, ?, ?)
           ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value`,
        )
        .run(auth.profileId, body.key, body.value);
    }
    audit(db, auth, "settings.profile.set", "setting", body.key);
    return { ok: true };
  });

  app.get("/api/profiles", async (request) => {
    const auth = requireAuth(db, request);
    if (!isAdmin(auth.role)) {
      return {
        profiles: [
          {
            id: auth.profileId,
            displayName: auth.displayName,
            role: auth.role,
            self: true,
          },
        ],
      };
    }

    const rows = db.sqlite
      .prepare(
        `SELECT profiles.id,
                profiles.display_name,
                profiles.simple_mode,
                profiles.disabled_at,
                users.username,
                users.role,
                users.disabled_at AS user_disabled_at
         FROM profiles
         JOIN users ON users.id = profiles.user_id
         ORDER BY users.created_at ASC`,
      )
      .all() as Array<{
      id: string;
      display_name: string;
      simple_mode: number;
      disabled_at: string | null;
      username: string;
      role: UserRole;
      user_disabled_at: string | null;
    }>;
    return {
      profiles: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        simpleMode: row.simple_mode === 1,
        disabled: row.disabled_at != null || row.user_disabled_at != null,
      })),
    };
  });

  app.post("/api/profiles", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    requireCsrf(request);
    const body = parseBody(createProfileSchema, request.body);
    if (auth.role !== "owner" && body.role === "admin") {
      throw httpError(403, "Only the owner can create admin profiles.");
    }
    const passwordHash = await hashPassword(body.password);
    const ids = db.transaction(() => {
      const created = createUserAndProfile(db, {
        username: body.username,
        displayName: body.displayName,
        passwordHash,
        role: body.role,
        simpleMode: body.simpleMode,
      });
      audit(db, auth, "profile.create", "profile", created.profileId, {
        username: body.username,
        role: body.role,
      });
      return created;
    });
    return {
      profile: {
        id: ids.profileId,
        username: body.username,
        displayName: body.displayName,
        role: body.role,
        simpleMode: body.simpleMode,
      },
    };
  });

  app.patch("/api/profiles/:id", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const id = (request.params as { id: string }).id;
    if (auth.profileId !== id && !isAdmin(auth.role)) {
      throw httpError(403, "Cannot edit another profile.");
    }
    const body = parseBody(patchProfileSchema, request.body);
    const existing = db.sqlite
      .prepare(
        `SELECT profiles.id, profiles.user_id, users.role
         FROM profiles JOIN users ON users.id = profiles.user_id
         WHERE profiles.id = ?`,
      )
      .get(id) as { id: string; user_id: string; role: UserRole } | undefined;
    if (existing == null) throw httpError(404, "Profile not found.");

    const now = nowISO();
    if (body.displayName != null) {
      db.sqlite
        .prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?")
        .run(body.displayName, now, id);
      db.sqlite
        .prepare("UPDATE users SET display_name = ? WHERE id = ?")
        .run(body.displayName, existing.user_id);
    }
    if (body.simpleMode != null) {
      db.sqlite
        .prepare("UPDATE profiles SET simple_mode = ?, updated_at = ? WHERE id = ?")
        .run(body.simpleMode ? 1 : 0, now, id);
    }
    if (body.disabled != null) {
      requireAdmin(auth);
      if (existing.role === "owner") throw httpError(400, "Owner profile cannot be disabled.");
      const disabledAt = body.disabled ? now : null;
      db.sqlite
        .prepare("UPDATE profiles SET disabled_at = ?, updated_at = ? WHERE id = ?")
        .run(disabledAt, now, id);
      db.sqlite
        .prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
        .run(disabledAt, existing.user_id);
    }
    audit(db, auth, "profile.update", "profile", id);
    return { ok: true };
  });

  app.delete("/api/profiles/:id", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    requireCsrf(request);
    const id = (request.params as { id: string }).id;
    const row = db.sqlite
      .prepare(
        `SELECT profiles.user_id, users.role
         FROM profiles JOIN users ON users.id = profiles.user_id
         WHERE profiles.id = ?`,
      )
      .get(id) as { user_id: string; role: UserRole } | undefined;
    if (row == null) throw httpError(404, "Profile not found.");
    if (row.role === "owner") throw httpError(400, "Owner profile cannot be disabled.");
    const now = nowISO();
    db.sqlite.prepare("UPDATE profiles SET disabled_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    db.sqlite.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(now, row.user_id);
    audit(db, auth, "profile.disable", "profile", id);
    return { ok: true };
  });

  app.get("/api/admin/invites", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    const rows = db.sqlite
      .prepare(
        `SELECT id, label, role, simple_mode, max_uses, used_count,
                created_at, expires_at, revoked_at
         FROM invites
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all() as Array<Parameters<typeof mapInviteRow>[0]>;
    return { invites: rows.map(mapInviteRow) };
  });

  app.post("/api/admin/invites", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    requireCsrf(request);
    const body = parseBody(createInviteSchema, request.body);
    if (auth.role !== "owner" && body.role === "admin") {
      throw httpError(403, "Only the owner can create admin invites.");
    }
    const id = randomId("invite");
    const token = randomToken(32);
    const now = nowISO();
    const expiresAt = addSecondsISO(body.expiresInSeconds);
    db.sqlite
      .prepare(
        `INSERT INTO invites
         (id, token_hash, created_by_user_id, created_by_profile_id, label,
          role, simple_mode, max_uses, used_count, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        sha256(token),
        auth.userId,
        auth.profileId,
        body.label ?? null,
        body.role,
        body.simpleMode ? 1 : 0,
        body.maxUses,
        now,
        expiresAt,
      );
    const row = db.sqlite
      .prepare(
        `SELECT id, label, role, simple_mode, max_uses, used_count,
                created_at, expires_at, revoked_at
         FROM invites
         WHERE id = ?`,
      )
      .get(id) as Parameters<typeof mapInviteRow>[0];
    audit(db, auth, "invite.create", "invite", id, {
      role: body.role,
      maxUses: body.maxUses,
    });
    return {
      invite: mapInviteRow(row),
      token,
    };
  });

  app.delete("/api/admin/invites/:id", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    requireCsrf(request);
    const id = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .parse((request.params as { id: string }).id);
    db.sqlite
      .prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(nowISO(), id);
    audit(db, auth, "invite.revoke", "invite", id);
    return { ok: true };
  });

  app.get("/api/admin/audit-log", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    const query = parseBody(auditLogQuerySchema, request.query);
    const rows = db.sqlite
      .prepare(
        `SELECT audit_log.id,
                audit_log.actor_user_id,
                audit_log.actor_profile_id,
                users.username AS actor_username,
                profiles.display_name AS actor_display_name,
                audit_log.action,
                audit_log.target_type,
                audit_log.target_id,
                audit_log.metadata_json,
                audit_log.created_at
         FROM audit_log
         LEFT JOIN users ON users.id = audit_log.actor_user_id
         LEFT JOIN profiles ON profiles.id = audit_log.actor_profile_id
         ORDER BY audit_log.created_at DESC
         LIMIT ?`,
      )
      .all(query.limit) as Array<Parameters<typeof mapAuditLogRow>[0]>;
    return { events: rows.map(mapAuditLogRow) };
  });

  app.get("/api/library/watchlist", async (request) => {
    const auth = requireAuth(db, request);
    const rows = db.sqlite
      .prepare(
        `SELECT media_id, added_at, preview_json
         FROM watchlist
         WHERE profile_id = ?
         ORDER BY added_at DESC`,
      )
      .all(auth.profileId) as Array<{
      media_id: string;
      added_at: string;
      preview_json: string;
    }>;
    return {
      items: rows.map((row) => ({
        mediaId: row.media_id,
        addedAt: row.added_at,
        preview: deserializePreview(row.preview_json),
      })),
    };
  });

  app.put("/api/library/watchlist/:mediaId", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const mediaId = (request.params as { mediaId: string }).mediaId;
    const body = parseBody(watchlistBodySchema, request.body);
    db.sqlite
      .prepare(
        `INSERT INTO watchlist (profile_id, media_id, added_at, preview_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, media_id)
         DO UPDATE SET preview_json = excluded.preview_json`,
      )
      .run(auth.profileId, mediaId, nowISO(), serializePreview(body.preview));
    audit(db, auth, "watchlist.upsert", "media", mediaId);
    return { ok: true };
  });

  app.delete("/api/library/watchlist/:mediaId", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const mediaId = (request.params as { mediaId: string }).mediaId;
    db.sqlite
      .prepare("DELETE FROM watchlist WHERE profile_id = ? AND media_id = ?")
      .run(auth.profileId, mediaId);
    audit(db, auth, "watchlist.delete", "media", mediaId);
    return { ok: true };
  });

  app.get("/api/history", async (request) => {
    const auth = requireAuth(db, request);
    const query = request.query as { limit?: string };
    const limit = parseLimit(query.limit, 100, 500);
    const rows = db.sqlite
      .prepare(
        `SELECT media_id, episode_id, progress_seconds, duration_seconds,
                completed, last_watched, stream_quality, preview_json
         FROM watch_history
         WHERE profile_id = ?
         ORDER BY last_watched DESC
         LIMIT ?`,
      )
      .all(auth.profileId, limit) as Parameters<typeof mapWatchHistoryRow>[0][];
    return { items: rows.map(mapWatchHistoryRow) };
  });

  app.put("/api/history/:mediaId", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const mediaId = (request.params as { mediaId: string }).mediaId;
    const body = parseBody(historyBodySchema, request.body);
    const episodeId = body.episodeId ?? null;
    const episodeKey = episodeId ?? "";
    db.sqlite
      .prepare(
        `INSERT INTO watch_history
         (profile_id, media_id, episode_key, episode_id, progress_seconds,
          duration_seconds, completed, last_watched, stream_quality, preview_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, media_id, episode_key)
         DO UPDATE SET
           episode_id = excluded.episode_id,
           progress_seconds = excluded.progress_seconds,
           duration_seconds = excluded.duration_seconds,
           completed = excluded.completed,
           last_watched = excluded.last_watched,
           stream_quality = excluded.stream_quality,
           preview_json = excluded.preview_json`,
      )
      .run(
        auth.profileId,
        mediaId,
        episodeKey,
        episodeId,
        body.progressSeconds,
        body.durationSeconds ?? null,
        body.completed ? 1 : 0,
        body.lastWatched ?? nowISO(),
        body.streamQuality ?? null,
        serializePreview(body.preview),
      );
    audit(db, auth, "history.upsert", "media", mediaId);
    return { ok: true };
  });

  app.get("/api/credentials/effective", async (request) => {
    const auth = requireAuth(db, request);
    return { credentials: effectiveCredentials(db, auth.profileId) };
  });

  app.put("/api/admin/credentials", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    requireCsrf(request);
    const body = parseBody(credentialBodySchema, request.body);
    const credential = upsertCredential(db, config, body, "server", null);
    audit(db, auth, "credential.server.upsert", "credential", credential.id, {
      provider: credential.provider,
    });
    return { credential };
  });

  app.put("/api/profile/credentials", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const body = parseBody(credentialBodySchema, request.body);
    const credential = upsertCredential(db, config, body, "profile", auth.profileId);
    audit(db, auth, "credential.profile.upsert", "credential", credential.id, {
      provider: credential.provider,
    });
    return { credential };
  });

  app.delete("/api/profile/credentials/:id", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const id = (request.params as { id: string }).id;
    db.sqlite
      .prepare("DELETE FROM credential_secrets WHERE id = ? AND scope = 'profile' AND profile_id = ?")
      .run(id, auth.profileId);
    audit(db, auth, "credential.profile.delete", "credential", id);
    return { ok: true };
  });

  app.get("/api/search", async (request) => {
    const auth = requireAuth(db, request);
    const query = parseBody(mediaSearchQuerySchema, request.query);
    return searchServerMedia(db, config, auth.profileId, {
      query: query.q,
      type: query.type === "all" ? null : query.type,
      page: query.page,
    });
  });

  app.get("/api/discover/home", async (request) => {
    const auth = requireAuth(db, request);
    return getServerDiscoverHome(db, config, auth.profileId);
  });

  app.get("/api/catalog/category", async (request) => {
    const auth = requireAuth(db, request);
    const query = parseBody(mediaCategoryQuerySchema, request.query);
    return getServerCategory(db, config, auth.profileId, query);
  });

  app.get("/api/catalog/discover", async (request) => {
    const auth = requireAuth(db, request);
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const query = parseBody(mediaDiscoverBaseQuerySchema, rawQuery);
    const params = stringQueryParams(rawQuery, new Set(["type"]));
    if (params.page == null) params.page = "1";
    if (params.language == null) params.language = "en-US";
    if (params.include_adult == null) params.include_adult = "false";
    return discoverServerMedia(db, config, auth.profileId, {
      type: query.type,
      params,
    });
  });

  app.get("/api/genres", async (request) => {
    const auth = requireAuth(db, request);
    const query = parseBody(mediaGenresQuerySchema, request.query);
    return getServerGenres(db, config, auth.profileId, query);
  });

  app.post("/api/calendar/upcoming", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    const body = parseBody(upcomingEpisodesBodySchema, request.body);
    return getServerUpcomingEpisodes(db, config, auth.profileId, {
      series: body.series.filter(isSeriesPreviewInput),
    });
  });

  app.get("/api/media/detail", async (request) => {
    const auth = requireAuth(db, request);
    const query = parseBody(mediaDetailQuerySchema, request.query);
    return getServerDetail(db, config, auth.profileId, {
      id: query.id,
      type: query.type,
    });
  });

  app.get("/api/streams/:imdbId", async (request) => {
    const auth = requireAuth(db, request);
    const imdbId = z
      .string()
      .trim()
      .min(1)
      .max(64)
      .parse((request.params as { imdbId: string }).imdbId);
    const query = parseBody(streamSearchQuerySchema, request.query);
    return searchServerStreams(db, config, auth.profileId, {
      imdbId,
      type: query.type,
      season: query.season ?? null,
      episode: query.episode ?? null,
    });
  });

  app.post("/api/streams/resolve", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    rateLimit(request, `streams:resolve:${auth.profileId}`, 120, 60 * 1000);
    const body = parseBody(resolveStreamSchema, request.body);
    const directStream = await resolveServerStream(db, config, auth.profileId, {
      infoHash: body.infoHash,
      preferredService: body.preferredService ?? null,
    });
    const session = createStreamSession(db, config, auth, {
      upstreamUrl: directStream.streamURL,
      contentType: streamContentType(directStream.fileName),
      title: directStream.fileName,
      expiresInSeconds: body.expiresInSeconds,
    });
    audit(db, auth, "stream_session.debrid.create", "stream_session", session.id, {
      infoHash: body.infoHash,
      debridService: directStream.debridService,
    });
    return {
      stream: {
        ...directStream,
        streamURL: session.playbackUrl,
      },
      session,
    };
  });

  app.post("/api/streams/sessions/raw", async (request) => {
    const auth = requireAuth(db, request);
    requireCsrf(request);
    rateLimit(request, `streams:raw:${auth.profileId}`, 120, 60 * 1000);
    if (!config.allowRawStreamUrls && !isAdmin(auth.role)) {
      throw httpError(403, "Raw stream sessions are disabled.");
    }
    const body = parseBody(rawStreamSessionSchema, request.body);
    const session = createStreamSession(db, config, auth, {
      upstreamUrl: body.upstreamUrl,
      contentType: body.contentType ?? null,
      title: body.title ?? null,
      expiresInSeconds: body.expiresInSeconds,
    });
    audit(db, auth, "stream_session.raw.create", "stream_session", session.id);
    return {
      session,
    };
  });

  app.get("/api/usage/streams", async (request) => {
    const auth = requireAuth(db, request);
    const query = parseBody(streamUsageQuerySchema, request.query);
    return streamUsageSummary(db, auth.profileId, query.days);
  });

  app.get("/api/admin/usage/streams", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    const query = parseBody(streamUsageQuerySchema, request.query);
    return adminStreamUsageSummary(db, query.days);
  });

  app.get("/api/admin/streams/active", async (request) => {
    const auth = requireAuth(db, request);
    requireAdmin(auth);
    return adminActiveStreamSessions(db);
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/stream/:id",
    handler: async (request, reply) => {
      const auth = requireAuth(db, request);
      const id = (request.params as { id: string }).id;
      const row = db.sqlite
        .prepare(
          `SELECT id, encrypted_upstream_url, content_type
           FROM stream_sessions
           WHERE id = ?
             AND profile_id = ?
             AND revoked_at IS NULL
             AND expires_at > ?
           LIMIT 1`,
        )
        .get(id, auth.profileId, nowISO()) as
        | {
            id: string;
            encrypted_upstream_url: string;
            content_type: string | null;
          }
        | undefined;
      if (row == null) throw httpError(404, "Stream session not found.");

      const upstreamUrl = decryptSecret(row.encrypted_upstream_url, config.secretKey);
      const headers: Record<string, string> = {};
      const range = request.headers.range;
      if (typeof range === "string") headers.range = range;

      const controller = new AbortController();
      request.raw.once("close", () => controller.abort());

      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        signal: controller.signal,
      });

      reply.status(upstream.status);
      for (const header of [
        "accept-ranges",
        "content-length",
        "content-range",
        "content-type",
        "etag",
        "last-modified",
      ]) {
        const value = upstream.headers.get(header);
        if (value != null) reply.header(header, value);
      }
      if (row.content_type != null && upstream.headers.get("content-type") == null) {
        reply.header("content-type", row.content_type);
      }

      if (request.method === "HEAD" || upstream.body == null) {
        recordStreamTransfer(db, {
          sessionId: row.id,
          profileId: auth.profileId,
          bytes: 0,
          status: upstream.status,
          completed: true,
        });
        return reply.send();
      }

      return reply.send(
        countedStream(db, {
          sessionId: row.id,
          profileId: auth.profileId,
          status: upstream.status,
          body: upstream.body as ReadableStream<Uint8Array>,
        }),
      );
    },
  });
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.config);
  const db = new AppDatabase(config.databasePath);
  const app = Fastify({
    logger: config.logger,
    trustProxy: config.trustProxy,
  });

  await app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const origin = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    const allowedOrigin = allowedCorsOrigin(origin, config);
    if (allowedOrigin != null) {
      reply.header("access-control-allow-origin", allowedOrigin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
      reply.header(
        "access-control-allow-headers",
        "content-type, x-csrf-token",
      );
      reply.header(
        "access-control-allow-methods",
        "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
      );
    }
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const zodError = error instanceof z.ZodError;
    const statusCode = zodError ? 400 : ((error as { statusCode?: number }).statusCode ?? 500);
    const message = error instanceof Error ? error.message : "Request failed.";
    if (statusCode >= 500) app.log.error(error);
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error." : message,
      issues: zodError ? error.issues : undefined,
    });
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  registerRoutes(app, db, config);
  registerStaticApp(app, config);
  return app;
}
