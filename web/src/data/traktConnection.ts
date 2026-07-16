// Trakt OAuth token storage and refresh. Kept as its own module (not part of
// AppSettings) because the access/refresh tokens arrive from an async device
// poll rather than a text field, and because token handling is deliberately
// isolated from the rest of the settings spine.
//
// Storage split, mirroring how debrid/tmdb credentials are handled:
//   - the access + refresh tokens go through SecretStore (OS keychain in the
//     desktop app, Dexie fallback in the browser), never the plain KV table;
//   - the non-secret metadata (issued-at, lifetime, username, scope) lives in
//     the KV store so we can compute expiry and show who is connected without
//     touching the keychain on every read.
import { getSecretStore, getStore } from "../storage";
import { TraktSyncService } from "../services/sync/TraktSyncService";
import type { TraktTokenResponse } from "../services/sync/models";

// SecretStore key namespace for the two tokens (parallels debridSecretKey).
const ACCESS_TOKEN_SECRET = "trakt.access_token";
const REFRESH_TOKEN_SECRET = "trakt.refresh_token";
// KV key holding the JSON metadata blob (non-secret).
const TOKEN_META_KEY = "trakt_token_meta";

/** Non-secret metadata about the current Trakt token. */
export interface TraktTokenMeta {
  createdAt: number;
  expiresIn: number;
  tokenType: string;
  scope: string;
  username: string | null;
}

/** A fully-loaded connection: the live access token plus its metadata. */
export interface TraktConnection {
  accessToken: string;
  refreshToken: string;
  meta: TraktTokenMeta;
}

function metaFromToken(
  token: TraktTokenResponse,
  username: string | null,
): TraktTokenMeta {
  return {
    createdAt: token.createdAt,
    expiresIn: token.expiresIn,
    tokenType: token.tokenType,
    scope: token.scope,
    username,
  };
}

/** Persist a freshly-issued (or refreshed) token set. The two tokens are
 *  written to SecretStore and the metadata to the KV store. */
export async function saveTraktTokens(
  token: TraktTokenResponse,
  username: string | null = null,
): Promise<void> {
  const secrets = getSecretStore();
  // Write both secrets first; if the keychain is locked/denied this rejects
  // before we advertise a connection via the meta key, so a failed save never
  // leaves a dangling "connected" marker pointing at absent tokens.
  await secrets.setSecret(ACCESS_TOKEN_SECRET, token.accessToken);
  await secrets.setSecret(REFRESH_TOKEN_SECRET, token.refreshToken);
  await getStore().setSetting(
    TOKEN_META_KEY,
    JSON.stringify(metaFromToken(token, username)),
  );
}

function parseMeta(raw: string | null): TraktTokenMeta | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TraktTokenMeta>;
    if (
      typeof parsed.createdAt !== "number" ||
      typeof parsed.expiresIn !== "number"
    ) {
      return null;
    }
    return {
      createdAt: parsed.createdAt,
      expiresIn: parsed.expiresIn,
      tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : "bearer",
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      username: typeof parsed.username === "string" ? parsed.username : null,
    };
  } catch {
    return null;
  }
}

/** Load the stored connection, or null if Trakt is not connected. Requires the
 *  meta blob AND both tokens to be present - a partial state reads as
 *  disconnected so the UI never shows "connected" without usable tokens. */
export async function loadTraktConnection(): Promise<TraktConnection | null> {
  const meta = parseMeta(await getStore().getSetting(TOKEN_META_KEY));
  if (meta == null) return null;
  const secrets = getSecretStore();
  const [accessToken, refreshToken] = await Promise.all([
    secrets.getSecret(ACCESS_TOKEN_SECRET),
    secrets.getSecret(REFRESH_TOKEN_SECRET),
  ]);
  if (accessToken == null || refreshToken == null) return null;
  return { accessToken, refreshToken, meta };
}

/** True when a connection is present (cheap KV read; does not touch the
 *  keychain). Use loadTraktConnection when the tokens are actually needed. */
export async function isTraktConnected(): Promise<boolean> {
  return (await getStore().getSetting(TOKEN_META_KEY)) != null;
}

/** Remove the stored connection. Clears the KV meta first so the connection
 *  reads as gone even if a fail-closed keychain delete leaves an orphaned
 *  (unreferenced, harmless) token behind - the same ordering settings.ts uses
 *  for its secret deletes. */
export async function clearTraktConnection(): Promise<void> {
  await getStore().setSetting(TOKEN_META_KEY, null);
  const secrets = getSecretStore();
  try {
    await secrets.deleteSecret(ACCESS_TOKEN_SECRET);
    await secrets.deleteSecret(REFRESH_TOKEN_SECRET);
  } catch {
    // A keychain failure here leaves unreferenced tokens, which is harmless
    // (nothing points at them) and must not abort the disconnect.
  }
}

/** Return a valid access token, refreshing transparently when the stored one
 *  is expired (or within the service's expiry buffer). Returns null when Trakt
 *  is not connected. Throws only if a refresh is required but fails - callers
 *  should treat that as "needs reconnect".
 *
 *  The client id/secret come from AppSettings (user-registered Trakt app); the
 *  refreshed token is re-persisted so the next call is cheap. */
export async function getValidAccessToken(
  service: TraktSyncService,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const conn = await loadTraktConnection();
  if (conn == null) return null;
  if (!TraktSyncService.isExpired(conn.meta.createdAt, conn.meta.expiresIn)) {
    return conn.accessToken;
  }
  const refreshed = await service.refreshToken(
    clientId,
    clientSecret,
    conn.refreshToken,
  );
  await saveTraktTokens(refreshed, conn.meta.username);
  return refreshed.accessToken;
}
