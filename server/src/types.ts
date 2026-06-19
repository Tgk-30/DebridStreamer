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
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  sessionTtlSeconds: number;
  allowRawStreamUrls: boolean;
  trustProxy: boolean;
  corsOrigin: string | null;
  logger: boolean;
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
}

export interface BuildAppOptions {
  config?: Partial<ServerConfig>;
}
