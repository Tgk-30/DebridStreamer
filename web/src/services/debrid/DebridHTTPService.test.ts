// Mirrors Tests/.../Services/Debrid/DebridHTTPServiceTests.swift.
//
// Cross-service request-shape checks (no credential leakage in the query, the
// right Bearer header and form body) plus the TorBox best-file selection /
// fallback / not-ready guard.

import { describe, expect, it } from "vitest";
import { AllDebridService } from "./AllDebridService";
import { PremiumizeService } from "./PremiumizeService";
import { TorBoxService } from "./TorBoxService";
import { DebridError, type FetchImpl } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeMockFetch(handler: (req: CapturedRequest) => MockResponse): {
  fetchImpl: FetchImpl;
  requests: CapturedRequest[];
  byPath: (path: string) => CapturedRequest | undefined;
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const captured: CapturedRequest = {
      url: new URL(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? "",
    };
    requests.push(captured);
    const { status, body } = handler(captured);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    requests,
    byPath: (path) => requests.find((r) => r.url.pathname === path),
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

describe("Debrid HTTP request shapes", () => {
  it("services avoid credential query leakage and send expected payloads", async () => {
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/user":
          return ok(
            JSON.stringify({
              data: {
                user: {
                  username: "ad-user",
                  email: "ad@example.com",
                  isPremium: true,
                  premiumUntil: 1700000000,
                },
              },
            }),
          );
        case "/api/account/info":
          return ok(JSON.stringify({ customer_id: "pm-user", premium_until: 1700000000 }));
        case "/api/transfer/directdl":
          return ok(
            JSON.stringify({
              content: [{ link: "https://stream.example/file.mkv", path: "file.mkv", size: 1234 }],
            }),
          );
        case "/v1/api/torrents/mylist":
          return ok(
            JSON.stringify({
              data: {
                id: 42,
                download_state: "cached",
                files: [{ id: 0, name: "movie.mp4", size: 1234 }],
              },
            }),
          );
        case "/v1/api/torrents/requestdl":
          return ok(JSON.stringify({ data: "https://torbox.example/stream.mp4" }));
        default:
          return { status: 404, body: "{}" };
      }
    });

    const allDebrid = new AllDebridService("all-token", mock.fetchImpl);
    await allDebrid.getAccountInfo();

    const premiumize = new PremiumizeService("pm-token", mock.fetchImpl);
    await premiumize.getAccountInfo();
    await premiumize.getStreamURL("transfer123");

    const torBox = new TorBoxService("tb-token", mock.fetchImpl);
    await torBox.getStreamURL("42");

    const allDebridRequest = mock.byPath("/v4/user")!;
    expect(allDebridRequest.headers.Authorization).toBe("Bearer all-token");
    expect(allDebridRequest.url.search.includes("apikey=")).toBe(false);

    const premiumizeAccountRequest = mock.byPath("/api/account/info")!;
    expect(premiumizeAccountRequest.headers.Authorization).toBe("Bearer pm-token");
    expect(premiumizeAccountRequest.url.search.includes("apikey=")).toBe(false);

    const premiumizeDirectRequest = mock.byPath("/api/transfer/directdl")!;
    expect(premiumizeDirectRequest.body).toContain("src_id=transfer123");
    expect(premiumizeDirectRequest.body.includes("magnet:?xt=urn:btih:")).toBe(false);
    expect(premiumizeDirectRequest.url.search.includes("apikey=")).toBe(false);

    const torBoxRequest = mock.byPath("/v1/api/torrents/requestdl")!;
    expect(torBoxRequest.headers.Authorization).toBe("Bearer tb-token");
    expect(torBoxRequest.url.search.includes("token=")).toBe(false);
  });
});

describe("TorBox file selection", () => {
  it("picks the best file id from the torrent file list", async () => {
    let requestDownloadURL: URL | null = null;
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v1/api/torrents/mylist":
          return ok(
            JSON.stringify({
              data: {
                id: 55,
                download_state: "cached",
                files: [
                  { id: 8, name: "Movie.2026.sample.mkv", size: 5000000000 },
                  { id: 12, name: "Movie.2026.1080p.x264.mp4", size: 2500000000 },
                  { id: 21, name: "Movie.2026.Soundtrack.flac", size: 150000000 },
                ],
              },
            }),
          );
        case "/v1/api/torrents/requestdl":
          requestDownloadURL = req.url;
          return ok(JSON.stringify({ data: "https://torbox.example/movie.mp4" }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const torBox = new TorBoxService("tb-token", mock.fetchImpl);
    const stream = await torBox.getStreamURL("55");

    expect(stream.fileName).toBe("Movie.2026.1080p.x264.mp4");
    expect(stream.quality).toBe("1080p");
    expect(stream.codec).toBe("H.264");
    expect(requestDownloadURL!.search.includes("file_id=12")).toBe(true);
  });

  it("falls back to file_id=0 when files are unavailable but the torrent is ready", async () => {
    let requestDownloadURL: URL | null = null;
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v1/api/torrents/mylist":
          return ok(JSON.stringify({ data: { id: 90, download_state: "cached", files: [] } }));
        case "/v1/api/torrents/requestdl":
          requestDownloadURL = req.url;
          return ok(JSON.stringify({ data: "https://torbox.example/fallback.mp4" }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const torBox = new TorBoxService("tb-token", mock.fetchImpl);
    await torBox.getStreamURL("90");

    expect(requestDownloadURL!.search.includes("file_id=0")).toBe(true);
  });

  it("throws instead of streaming file_id=0 when the torrent is not ready", async () => {
    let didRequestDownload = false;
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v1/api/torrents/mylist":
          return ok(
            JSON.stringify({ data: { id: 77, download_state: "stalled (no seeds)", files: [] } }),
          );
        case "/v1/api/torrents/requestdl":
          didRequestDownload = true;
          return ok(JSON.stringify({ data: "https://torbox.example/should-not-happen.mp4" }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const torBox = new TorBoxService("tb-token", mock.fetchImpl);

    await expect(torBox.getStreamURL("77")).rejects.toBeInstanceOf(DebridError);
    expect(didRequestDownload).toBe(false);
  });
});
