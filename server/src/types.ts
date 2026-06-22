export type UserRole = "owner" | "admin" | "member" | "restricted";
export type CookieSameSite = "lax" | "strict" | "none";

export type CredentialProvider =
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

export const CREDENTIAL_PROVIDERS: CredentialProvider[] = [
  "tmdb",
  "omdb",
  "real_debrid",
  "all_debrid",
  "premiumize",
  "torbox",
  "openai",
  "anthropic",
  "ollama",
  "opensubtitles",
  "trakt",
];

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  dataDir: string;
  webDistPath: string | null;
  secretKey: Buffer;
  /** Optional one-time owner-setup token. When configured, the first owner
   *  account cannot be created without this out-of-band token. */
  setupToken: string | null;
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  sessionTtlSeconds: number;
  allowRawStreamUrls: boolean;
  /** Operator opt-in for server-side HLS transcoding (Phase 3b). Default false.
   *  When false — or when ffmpeg is absent at boot — the transcode routes 404 and
   *  the /api/stream/:id proxy is byte-for-byte unchanged. */
  enableTranscode: boolean;
  /** Max concurrent ffmpeg transcode jobs. Default 1 (Pi-friendly). */
  maxTranscodes: number;
  /** How long to wait for ffmpeg to produce the first HLS manifest+segment
   *  before giving up with a 504. Default 30s (raise on slow disks/CPUs). */
  transcodeStartTimeoutMs: number;
  trustProxy: boolean;
  corsOrigin: string | null;
  logger: boolean;
  /** "Hidden key" OMDb support: a server-held OMDb API key used to enrich
   *  titles with IMDb / Rotten Tomatoes / Metacritic ratings via the
   *  `/api/omdb/:imdbId` proxy. Lives ONLY on the server (this env value, or an
   *  encrypted server/profile credential) and is never sent to clients — so a
   *  limited-distribution build ships ratings with an unextractable key. A
   *  per-profile OMDb credential, when set, overrides this. Null = no
   *  server-provided OMDb (clients fall back to their own key, if any). */
  omdbApiKey: string | null;
}

export interface AuthContext {
  userId: string;
  username: string;
  role: UserRole;
  /** The ACTIVE household sub-profile for this session (the "who's watching"
   * choice), resolved from sessions.active_profile_id with a fallback to the
   * account's is_default profile. All per-profile data scoping follows it. */
  profileId: string;
  displayName: string;
  /** The active profile's avatar tint (hex/keyword), or null for the default. */
  avatarColor: string | null;
  sessionId: string;
  /** Whether the active profile is in Simple (progressive-disclosure) mode. */
  simpleMode: boolean;
  /** Whether the active profile is a locked-down kid profile (search disabled,
   * curated movie-only browse). Independent of `maturityMax` in principle, but
   * an owner sets them together. */
  isKid: boolean;
  /** The active profile's maturity ceiling — a US movie certification
   * (G/PG/PG-13/R/NC-17), or null for no cap. The resolve play-block compares a
   * title's certification against this; null means unrestricted. */
  maturityMax: string | null;
}

export interface BuildAppOptions {
  config?: Partial<ServerConfig>;
  /** Test injection seam: swap the real ffmpeg child_process surface for a fake
   *  so CI never needs a real ffmpeg binary. Defaults to realTranscoder. */
  transcoder?: import("./transcode.js").Transcoder;
}
