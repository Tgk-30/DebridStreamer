// @vitest-environment jsdom
//
// Tests for the useBrowse React hook (browse.ts) - the stateful piece the pure
// browse.test.ts doesn't reach: page-1 load, no-key fixture fallback, loadMore
// appending + de-dup, canLoadMore gating, ctx-change re-load, the live-error
// fixture fallback, Server Mode routing, and the runIdRef stale-guard.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { BrowseContext } from "./browse";
import { useBrowse } from "./browse";
import type { MediaPreview } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";
import { emptyBrowseFilters } from "./browse";
import { isServerMode } from "../lib/serverMode";
import {
  fetchServerCategory,
  discoverServerMedia,
  searchServerMedia,
} from "../lib/serverApi";

vi.mock("../lib/serverMode", () => ({
  isServerMode: vi.fn(() => false),
}));

vi.mock("../lib/serverApi", () => ({
  fetchServerCategory: vi.fn(),
  discoverServerMedia: vi.fn(),
  searchServerMedia: vi.fn(),
}));

const mockIsServerMode = vi.mocked(isServerMode);
const mockFetchServerCategory = vi.mocked(fetchServerCategory);
const mockDiscoverServerMedia = vi.mocked(discoverServerMedia);
const mockSearchServerMedia = vi.mocked(searchServerMedia);

function preview(id: string): MediaPreview {
  return { id, type: "movie", title: id, year: 2020, imdbRating: 7 };
}

function pageResult(opts: {
  ids: string[];
  page: number;
  totalPages: number;
  totalResults?: number;
}) {
  return {
    items: opts.ids.map(preview),
    page: opts.page,
    totalPages: opts.totalPages,
    totalResults: opts.totalResults ?? opts.ids.length,
  };
}

const CATEGORY_CTX: BrowseContext = {
  kind: "category",
  type: "movie",
  category: "popular",
};

/** A controllable fake TMDBService. Only getCategory is used by CATEGORY_CTX. */
function fakeService(impl?: {
  getCategory?: (page: number) => Promise<ReturnType<typeof pageResult>>;
}) {
  const getCategory =
    impl?.getCategory ??
    ((page: number) =>
      Promise.resolve(pageResult({ ids: [`p${page}`], page, totalPages: 3 })));
  return {
    getCategory: vi.fn(async (_c: unknown, _t: unknown, page = 1) =>
      getCategory(page),
    ),
    getTrending: vi.fn(),
    search: vi.fn(),
    discover: vi.fn(),
    discoverWithParams: vi.fn(),
  } as unknown as TMDBService & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  mockIsServerMode.mockReturnValue(false);
  mockFetchServerCategory.mockReset();
  mockDiscoverServerMedia.mockReset();
  mockSearchServerMedia.mockReset();
});

describe("useBrowse - initial state", () => {
  it("starts in a loading/empty state before the first page resolves", () => {
    const svc = fakeService();
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));
    // Synchronous first render: effect's async page-1 hasn't resolved yet.
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.source).toBeNull();
    expect(result.current.canLoadMore).toBe(false);
    expect(typeof result.current.loadMore).toBe("function");
  });
});

describe("useBrowse - live page-1 load", () => {
  it("loads page 1 from the service and sets canLoadMore when more pages remain", async () => {
    const svc = fakeService();
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("live");
    expect(result.current.items.map((i) => i.id)).toEqual(["p1"]);
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.error).toBeNull();
    expect(svc.getCategory).toHaveBeenCalledWith("popular", "movie", 1);
  });

  it("canLoadMore is false on the last page (page >= totalPages)", async () => {
    const svc = fakeService({
      getCategory: (page) =>
        Promise.resolve(pageResult({ ids: [`p${page}`], page, totalPages: 1 })),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canLoadMore).toBe(false);
  });
});

describe("useBrowse - fixture fallback (no key)", () => {
  it("renders a single fixture page when service is null and not in server mode", async () => {
    const { result } = renderHook(() => useBrowse(null, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("fixtures");
    expect(result.current.items.length).toBeGreaterThan(0);
    // Category context filters fixtures to the media type.
    expect(result.current.items.every((i) => i.type === "movie")).toBe(true);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.canLoadMore).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useBrowse - loadMore", () => {
  it("appends the next page and advances the cursor", async () => {
    const svc = fakeService();
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.page).toBe(2));
    expect(result.current.items.map((i) => i.id)).toEqual(["p1", "p2"]);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.canLoadMore).toBe(true); // 2 < 3
    expect(svc.getCategory).toHaveBeenLastCalledWith("popular", "movie", 2);
  });

  it("de-dups items repeated across pages", async () => {
    // Page 2 returns p1 (already present) + dup1; only dup1 should be appended.
    const svc = fakeService({
      getCategory: (page) =>
        page === 1
          ? Promise.resolve(
              pageResult({ ids: ["p1"], page: 1, totalPages: 2 }),
            )
          : Promise.resolve(
              pageResult({ ids: ["p1", "dup1"], page: 2, totalPages: 2 }),
            ),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.page).toBe(2));

    expect(result.current.items.map((i) => i.id)).toEqual(["p1", "dup1"]);
    expect(result.current.canLoadMore).toBe(false); // 2 >= 2
  });

  it("is a no-op on the fixtures source (no service)", async () => {
    const { result } = renderHook(() => useBrowse(null, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.items.length;

    act(() => result.current.loadMore());
    // Source is fixtures → loadMore short-circuits; no change.
    expect(result.current.items.length).toBe(before);
    expect(result.current.loadingMore).toBe(false);
  });

  it("is a no-op once on the last page (page >= totalPages)", async () => {
    const svc = fakeService({
      getCategory: (page) =>
        Promise.resolve(pageResult({ ids: [`p${page}`], page, totalPages: 1 })),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(false);
    // getCategory only called for page 1 - loadMore never requested page 2.
    expect(svc.getCategory).toHaveBeenCalledTimes(1);
  });

  it("stops paginating but keeps items when a load-more page errors", async () => {
    const svc = fakeService({
      getCategory: (page) =>
        page === 1
          ? Promise.resolve(
              pageResult({ ids: ["p1"], page: 1, totalPages: 3 }),
            )
          : Promise.reject(new Error("boom")),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canLoadMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    // Page-1 items retained; pagination disabled after the append error.
    expect(result.current.items.map((i) => i.id)).toEqual(["p1"]);
    expect(result.current.canLoadMore).toBe(false);
    expect(result.current.page).toBe(1);
  });
});

describe("useBrowse - live error fallback", () => {
  it("falls back to a fixture page and surfaces the error message", async () => {
    const svc = fakeService({
      getCategory: () => Promise.reject(new Error("network down")),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("network down");
    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("stringifies a non-Error throw", async () => {
    const svc = fakeService({
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      getCategory: () => Promise.reject("plain string fail"),
    });
    const { result } = renderHook(() => useBrowse(svc, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("plain string fail");
    expect(result.current.source).toBe("fixtures");
  });
});

describe("useBrowse - context change re-loads", () => {
  it("re-runs page 1 when the context changes", async () => {
    const svc = fakeService();
    const { result, rerender } = renderHook(
      ({ ctx }) => useBrowse(svc, ctx),
      { initialProps: { ctx: CATEGORY_CTX } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCategory).toHaveBeenCalledWith("popular", "movie", 1);

    const nextCtx: BrowseContext = {
      kind: "category",
      type: "movie",
      category: "top_rated",
    };
    rerender({ ctx: nextCtx });

    await waitFor(() =>
      expect(svc.getCategory).toHaveBeenCalledWith("top_rated", "movie", 1),
    );
    expect(result.current.source).toBe("live");
  });

  it("does NOT re-load when a structurally-equal ctx object is passed (ctxKey stable)", async () => {
    const svc = fakeService();
    const { result, rerender } = renderHook(
      ({ ctx }) => useBrowse(svc, ctx),
      { initialProps: { ctx: { ...CATEGORY_CTX } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCategory).toHaveBeenCalledTimes(1);

    // Fresh object, same shape - JSON.stringify ctxKey is identical.
    rerender({ ctx: { ...CATEGORY_CTX } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCategory).toHaveBeenCalledTimes(1);
  });
});

describe("useBrowse - runIdRef stale-guard", () => {
  it("ignores a slow page-1 from a superseded context", async () => {
    // First ctx's load resolves AFTER the context already changed; its result
    // must be dropped (runIdRef mismatch), so the second ctx's items win.
    let resolveSlow: (v: ReturnType<typeof pageResult>) => void = () => {};
    const slow = new Promise<ReturnType<typeof pageResult>>((res) => {
      resolveSlow = res;
    });

    const svc = {
      getCategory: vi.fn(async (_c: unknown, _t: unknown, _page = 1) => slow),
      getTrending: vi.fn(),
      search: vi.fn(),
      discover: vi.fn(),
      discoverWithParams: vi.fn(async () =>
        pageResult({ ids: ["fresh"], page: 1, totalPages: 1 }),
      ),
    } as unknown as TMDBService & Record<string, ReturnType<typeof vi.fn>>;

    const { result, rerender } = renderHook(
      ({ ctx }) => useBrowse(svc, ctx),
      { initialProps: { ctx: CATEGORY_CTX as BrowseContext } },
    );

    // Switch to a discover ctx (different runId) before the slow page resolves.
    const discoverCtx: BrowseContext = {
      kind: "discover",
      type: "movie",
      filters: emptyBrowseFilters(),
    };
    rerender({ ctx: discoverCtx });
    await waitFor(() =>
      expect(result.current.items.map((i) => i.id)).toEqual(["fresh"]),
    );

    // Now resolve the stale page-1; its setState must be guarded out.
    await act(async () => {
      resolveSlow(pageResult({ ids: ["STALE"], page: 1, totalPages: 5 }));
      await slow;
    });

    expect(result.current.items.map((i) => i.id)).toEqual(["fresh"]);
    expect(result.current.source).toBe("live");
  });
});

describe("useBrowse - Server Mode", () => {
  it("routes page-1 through the server API when isServerMode() is true", async () => {
    mockIsServerMode.mockReturnValue(true);
    mockFetchServerCategory.mockResolvedValue(
      pageResult({ ids: ["s1"], page: 1, totalPages: 2 }),
    );

    // service is null but server mode is on → loadServerBrowsePage path.
    const { result } = renderHook(() => useBrowse(null, CATEGORY_CTX));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.items.map((i) => i.id)).toEqual(["s1"]);
    expect(result.current.canLoadMore).toBe(true);
    expect(mockFetchServerCategory).toHaveBeenCalledWith({
      type: "movie",
      category: "popular",
      page: 1,
    });
  });

  it("loadMore in server mode requests the next page from the server API", async () => {
    mockIsServerMode.mockReturnValue(true);
    mockFetchServerCategory.mockImplementation(async ({ page }) =>
      pageResult({ ids: [`s${page}`], page: page ?? 1, totalPages: 3 }),
    );

    const { result } = renderHook(() => useBrowse(null, CATEGORY_CTX));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(result.current.items.map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(mockFetchServerCategory).toHaveBeenLastCalledWith({
      type: "movie",
      category: "popular",
      page: 2,
    });
  });
});
