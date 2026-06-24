// RemoteStore (Server-Mode storage backend) tests — fetch-mocked. Focus on the
// resume/continue-watching path hardened in the bug-hunt + core history calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteStore } from "./RemoteStore";

function jsonResponse(obj: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(obj),
  } as Response;
}

function histItem(over: Record<string, unknown> = {}) {
  return {
    mediaId: "tt1",
    episodeId: null,
    progressSeconds: 0,
    durationSeconds: null,
    completed: false,
    lastWatched: "2024-01-01T00:00:00.000Z",
    streamQuality: null,
    preview: { id: "tt1", type: "movie", title: "X" },
    ...over,
  };
}

describe("RemoteStore", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "" });
  });
  afterEach(() => vi.unstubAllGlobals());
  const store = () => new RemoteStore("http://srv");

  describe("getResume — exact-key lookup", () => {
    it("GETs /api/history/:mediaId and maps the item", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ item: histItem({ progressSeconds: 300, durationSeconds: 600 }) }),
      );
      const r = await store().getResume("tt1");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://srv/api/history/tt1",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
      expect(r?.progressSeconds).toBe(300);
      expect(r?.id).toBe("tt1:");
    });

    it("encodes a non-empty episodeId as a query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ item: null }));
      await store().getResume("tt1", "s1e1");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://srv/api/history/tt1?episodeId=s1e1",
        expect.anything(),
      );
    });

    it("omits the query for a null/empty episodeId and returns null when absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ item: null }));
      expect(await store().getResume("tt1", null)).toBeNull();
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://srv/api/history/tt1",
        expect.anything(),
      );
    });
  });

  describe("continueWatching — resumable-only, filtered before the slice", () => {
    it("keeps only resumable rows (drops viewed-only + completed), preserving order", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          items: [
            histItem({ mediaId: "a", progressSeconds: 0, durationSeconds: null }), // viewed-only
            histItem({ mediaId: "b", progressSeconds: 300, durationSeconds: 600 }), // resumable
            histItem({
              mediaId: "c",
              progressSeconds: 990,
              durationSeconds: 1000,
              completed: true,
            }), // finished
            histItem({ mediaId: "d", progressSeconds: 100, durationSeconds: 1000 }), // resumable
          ],
        }),
      );
      const r = await store().continueWatching(20);
      expect(r.map((x) => x.mediaId)).toEqual(["b", "d"]);
    });

    it("requests a wide window so older resumables aren't dropped, then slices", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          items: Array.from({ length: 5 }, (_, i) =>
            histItem({ mediaId: `m${i}`, progressSeconds: 100, durationSeconds: 1000 }),
          ),
        }),
      );
      const r = await store().continueWatching(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://srv/api/history?limit=500",
        expect.anything(),
      );
      expect(r).toHaveLength(2);
    });
  });

  describe("history writes", () => {
    it("recordHistory PUTs the row to /api/history/:mediaId with a CSRF header", async () => {
      vi.stubGlobal("document", { cookie: "ds_csrf=tok123" });
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await store().recordHistory({
        mediaId: "tt9",
        episodeId: null,
        progressSeconds: 42,
        durationSeconds: 100,
        completed: false,
        preview: { id: "tt9", type: "movie", title: "Z" },
      });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://srv/api/history/tt9");
      expect(init.method).toBe("PUT");
      expect(JSON.parse(init.body).progressSeconds).toBe(42);
    });

    it("listHistory maps the server items to records", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ items: [histItem({ mediaId: "x", progressSeconds: 5 })] }),
      );
      const rows = await store().listHistory();
      expect(rows[0]?.mediaId).toBe("x");
      expect(rows[0]?.id).toBe("x:");
    });
  });
});
