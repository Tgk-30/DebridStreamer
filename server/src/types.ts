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
  profileId: string;
  displayName: string;
  sessionId: string;
}

export interface BuildAppOptions {
  config?: Partial<ServerConfig>;
}
