// Port of Sources/DebridStreamer/Services/Debrid/RealDebridService.swift.
//
// A fetch-based Real-Debrid client. Mirrors the Swift actor's HTTP+JSON logic:
// the same API paths, Bearer auth (token never leaked into the query), the
// checkCache "all unknown" behavior, addMagnet/selectFiles/unrestrict parsing,
// the getStreamURL poll-and-pair-files flow, findExistingTorrent, and the
// status->DebridError mapping. The retry/poll SLEEP loops are preserved but the
// delay is injectable (`sleep`, default no-op) so tests never actually wait.

import {
  CacheStatus,
  type DebridAccountInfo,
  type DebridFileCandidate,
  DebridFileSelector,
  type DebridServiceType,
  DebridServiceType as DebridServiceTypeNS,
  type StreamInfo,
  AudioFormat,
  lastPathComponent,
  SourceType,
  VideoCodec,
  VideoQuality,
} from "./models";
import {
  type DebridService,
  DebridError,
  type FetchImpl,
  defaultFetchImpl,
  urlQueryEncode,
} from "./types";

/** Async delay used by retry/poll loops; default is a no-op so tests don't sleep. */
export type Sleep = (ms: number) => Promise<void>;
const noopSleep: Sleep = () => Promise.resolve();

/** Coerces a JSON value to a number (mirrors the Swift `int64Value` helper that
 * accepts NSNumber / Int / numeric String). Returns null when not coercible. */
function int64Value(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export class RealDebridService implements DebridService {
  readonly serviceType: DebridServiceType = DebridServiceTypeNS.realDebrid;
  private readonly apiToken: string;
  private readonly baseURL = "https://api.real-debrid.com/rest/1.0";
  private readonly fetchImpl: FetchImpl;
  private readonly sleep: Sleep;

  constructor(apiToken: string, fetchImpl?: FetchImpl, sleep: Sleep = noopSleep) {
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl ?? defaultFetchImpl();
    this.sleep = sleep;
  }

  // MARK: - Cache Check

  async checkCache(hashes: string[]): Promise<Record<string, CacheStatus>> {
    if (hashes.length === 0) return {};
    // RD disabled /torrents/instantAvailability — return .unknown for all.
    const results: Record<string, CacheStatus> = {};
    for (const hash of hashes) {
      results[hash.toLowerCase()] = CacheStatus.unknown;
    }
    return results;
  }

  // MARK: - Magnet Operations

  async addMagnet(hash: string): Promise<string> {
    const magnet = `magnet:?xt=urn:btih:${hash}`;
    const body = `magnet=${urlQueryEncode(magnet)}`;

    const maxRetries = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const data = await this.requestRaw("/torrents/addMagnet", "POST", body);
        const json = parseJSON(data);
        const id = json?.id;
        if (typeof id === "string") return id;
        throw DebridError.downloadFailed("Failed to parse magnet response");
      } catch (error) {
        lastError = error;
        if (
          error instanceof DebridError &&
          error.kind === "httpError" &&
          error.statusCode != null &&
          error.statusCode >= 500 &&
          error.statusCode <= 599
        ) {
          await this.sleep(2 ** attempt * 1000);
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : DebridError.downloadFailed(`Failed to add magnet after ${maxRetries} retries`);
  }

  async selectFiles(torrentId: string, fileIds: number[]): Promise<void> {
    const files = fileIds.length === 0 ? "all" : fileIds.map(String).join(",");
    const body = `files=${files}`;
    // 204 -> empty body; a non-2xx is a real failure and surfaces.
    await this.requestRaw(`/torrents/selectFiles/${torrentId}`, "POST", body);
  }

  async getStreamURL(torrentId: string): Promise<StreamInfo> {
    let status = "";
    let json: Record<string, unknown> = {};
    const backoffSchedule = [0.4, 0.8, 1.5, 3.0];
    const backoffCap = 5.0;
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const data = await this.requestRaw(`/torrents/info/${torrentId}`, "GET");
      const parsed = parseJSON(data);
      if (parsed == null) throw DebridError.torrentNotFound(torrentId);
      json = parsed;
      status = typeof json.status === "string" ? json.status : "";

      if (status === "downloaded") break;

      if (
        status === "error" ||
        status === "dead" ||
        status === "virus" ||
        status === "magnet_error"
      ) {
        throw DebridError.downloadFailed(`Torrent status: ${status}`);
      }

      if (status === "waiting_files_selection") {
        await this.selectFiles(torrentId, []);
      }

      if (attempt < maxAttempts - 1) {
        const delaySeconds =
          attempt < backoffSchedule.length ? backoffSchedule[attempt] : backoffCap;
        await this.sleep(delaySeconds * 1000);
      }
    }

    if (status !== "downloaded") {
      throw DebridError.downloadFailed(`Torrent not ready. Status: ${status}`);
    }

    const links = Array.isArray(json.links) ? (json.links as unknown[]) : null;
    const stringLinks =
      links?.filter((l): l is string => typeof l === "string") ?? [];
    if (stringLinks.length === 0) throw DebridError.noFilesAvailable();

    const candidates = this.fileCandidates(json, stringLinks);
    const selected = DebridFileSelector.selectBest(candidates);
    if (selected == null) throw DebridError.noFilesAvailable();

    const streamURL = await this.unrestrict(selected.link);

    const filename = lastPathComponent(selected.fileName);
    const bytes = selected.sizeBytes;

    return {
      streamURL,
      quality: VideoQuality.parse(filename),
      codec: VideoCodec.parse(filename),
      audio: AudioFormat.parse(filename),
      source: SourceType.parse(filename),
      sizeBytes: bytes,
      fileName: filename,
      debridService: "RD",
    };
  }

  private fileCandidates(
    json: Record<string, unknown>,
    links: string[],
  ): DebridFileCandidate[] {
    const files = Array.isArray(json.files)
      ? (json.files as Record<string, unknown>[])
      : null;
    if (files) {
      const selectedFiles = files
        .filter((f) => int64Value(f.selected) === 1)
        .sort((lhs, rhs) => {
          const l = int64Value(lhs.id) ?? Number.MAX_SAFE_INTEGER;
          const r = int64Value(rhs.id) ?? Number.MAX_SAFE_INTEGER;
          return l - r;
        });

      const candidates: DebridFileCandidate[] = [];
      links.forEach((link, index) => {
        if (index < selectedFiles.length) {
          const file = selectedFiles[index];
          const path =
            (typeof file.path === "string" ? file.path : null) ??
            (typeof file.filename === "string" ? file.filename : null) ??
            "Unknown";
          const size = int64Value(file.bytes) ?? 0;
          candidates.push({ link, fileName: path, sizeBytes: size });
        }
      });
      if (candidates.length > 0) return candidates;
    }

    const fallbackName =
      typeof json.filename === "string" ? json.filename : "Unknown";
    const fallbackSize = int64Value(json.bytes) ?? 0;
    return links.map((link) => ({
      link,
      fileName: fallbackName,
      sizeBytes: fallbackSize,
    }));
  }

  // MARK: - Unrestrict

  async unrestrict(link: string): Promise<string> {
    const body = `link=${urlQueryEncode(link)}`;

    const maxRetries = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const data = await this.requestRaw("/unrestrict/link", "POST", body);
        const json = parseJSON(data);
        const downloadStr = json?.download;
        if (typeof downloadStr === "string" && isValidURL(downloadStr)) {
          return downloadStr;
        }
        throw DebridError.downloadFailed("Failed to parse unrestrict response");
      } catch (error) {
        lastError = error;
        if (
          error instanceof DebridError &&
          error.kind === "httpError" &&
          error.statusCode != null &&
          error.statusCode >= 500 &&
          error.statusCode <= 599
        ) {
          await this.sleep(2 ** attempt * 1000);
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : DebridError.downloadFailed(`Failed to unrestrict link after ${maxRetries} retries`);
  }

  // MARK: - User Torrents

  /** Returns the torrent ID if a matching hash is found (downloaded/in-progress),
   * deletes error-state matches, and returns null otherwise. */
  async findExistingTorrent(hash: string): Promise<string | null> {
    const data = await this.requestRaw("/torrents?limit=100&page=1", "GET");
    const torrents = parseJSONArray(data);
    if (torrents == null) return null;

    const lowerHash = hash.toLowerCase();
    for (const torrent of torrents) {
      const torrentHash = torrent.hash;
      const id = torrent.id;
      if (
        typeof torrentHash === "string" &&
        torrentHash.toLowerCase() === lowerHash &&
        typeof id === "string"
      ) {
        const status = typeof torrent.status === "string" ? torrent.status : "";
        if (status === "downloaded") return id;
        if (status === "error" || status === "dead" || status === "magnet_error") {
          try {
            await this.deleteTorrent(id);
          } catch {
            // best-effort delete (mirrors Swift `try?`)
          }
          return null;
        }
        return id;
      }
    }
    return null;
  }

  /** Delete a torrent from the user's list. */
  async deleteTorrent(id: string): Promise<void> {
    await this.requestRaw(`/torrents/delete/${id}`, "DELETE");
  }

  // MARK: - Account

  async validateToken(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }

  async getAccountInfo(): Promise<DebridAccountInfo> {
    const data = await this.requestRaw("/user", "GET");
    const json = parseJSON(data);
    if (json == null) throw DebridError.invalidToken();

    const username = typeof json.username === "string" ? json.username : "Unknown";
    const email = typeof json.email === "string" ? json.email : null;
    const premium = typeof json.premium === "number" ? json.premium : 0;
    const points = typeof json.points === "number" ? json.points : null;

    let premiumExpiry: Date | null = null;
    if (typeof json.expiration === "string") {
      const parsed = new Date(json.expiration);
      premiumExpiry = Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return {
      username,
      email,
      premiumExpiry,
      isPremium: premium > 0,
      points,
    };
  }

  // MARK: - HTTP

  private async requestRaw(
    path: string,
    method: string,
    body?: string,
  ): Promise<string> {
    const url = this.baseURL + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    };
    if (body != null) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const response = await this.fetchImpl(url, { method, headers, body });
    const status = response.status;

    // 204 No Content is success (selectFiles, delete).
    if (status === 204) return "";

    if (!(status >= 200 && status <= 299)) {
      if (status === 401) throw DebridError.invalidToken();
      if (status === 403) throw DebridError.expired();
      if (status === 429) throw DebridError.rateLimited();
      const errorMsg = (await response.text().catch(() => "")) || "Unknown error";
      throw DebridError.httpError(status, errorMsg);
    }

    return response.text();
  }
}

// MARK: - JSON helpers

function parseJSON(text: string): Record<string, unknown> | null {
  if (text.length === 0) return null;
  try {
    const value = JSON.parse(text);
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJSONArray(text: string): Record<string, unknown>[] | null {
  if (text.length === 0) return null;
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

function isValidURL(value: string): boolean {
  try {
    // Mirrors `URL(string:)` — requires an absolute URL.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
