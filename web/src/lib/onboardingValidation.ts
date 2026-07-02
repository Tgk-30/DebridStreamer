// Live key validation for the first-run wizard. Both checks construct
// throwaway clients — nothing here persists anything; the wizard saves once
// at the end via updateSettings.

import { TMDBService } from "../services/metadata/TMDBService";
import { TMDBError } from "../services/metadata/types";
import { buildDebridService, type DebridTokenEntry } from "../data/settings";

export type TmdbTestResult = "ok" | "unauthorized" | "network";

/** One GET /search/multi with the candidate key. */
export async function testTmdbKey(key: string): Promise<TmdbTestResult> {
  try {
    await new TMDBService(key.trim()).search("test", null, 1);
    return "ok";
  } catch (err) {
    // 401 = bad key; 429 means the key REACHED TMDB (a rate-limited key is a
    // working key); anything else is network/CORS, not the key's fault.
    if (err instanceof TMDBError && err.kind === "unauthorized") return "unauthorized";
    if (err instanceof TMDBError && err.kind === "rateLimited") return "ok";
    return "network";
  }
}

/** true = verified. false = rejected OR unreachable — validateToken() is a
 *  catch-all boolean, so callers must hedge their copy (and offer a
 *  save-without-testing path: debrid hosts are CORS-blocked in plain
 *  browsers, where a valid token still fails this check). */
export async function testDebridToken(entry: DebridTokenEntry): Promise<boolean> {
  const service = buildDebridService(entry);
  if (service == null) return false;
  return service.validateToken();
}
