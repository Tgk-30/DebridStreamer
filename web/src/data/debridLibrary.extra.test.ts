// Extended coverage for the Debrid Library data layer (debridLibrary.ts).
//
// The existing debridLibrary.test.ts covers the happy paths of groupKey /
// markDuplicates / formatSize. This file pins down:
//   - BOUNDARY + NULL/EMPTY behavior of those pure exports (extension-strip
//     rules, MiB rounding, zero/negative/TB-cap byte formatting, empty lists,
//     three-way duplicate groups, mixed hash/name groups).
//   - The library LISTING / TRANSFORM that feeds the hook: DebridManager.
//     listTorrents() merge/sort/fault-tolerance (services queried concurrently,
//     a throwing service contributes no rows, a service without listTorrents
//     contributes nothing, service order preserved, empty-account path), with
//     the merged rows run through markDuplicates exactly as the hook does.
//
// The `useDebridLibrary` React hook itself is NOT rendered here: this project's
// vitest environment is "node" with no jsdom / @testing-library/react /
// react-test-renderer, so a hook render cannot be driven reliably. We test the
// async load logic it wraps (listTorrents -> markDuplicates -> duplicateCount)
// against mocked services instead of shipping a flaky renderer-based test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { groupKey, markDuplicates, formatSize } from "./debridLibrary";
import { DebridManager } from "../services/debrid/DebridManager";
import type { DebridService } from "../services/debrid/types";
import type { DebridServiceType, DebridTorrent } from "../services/debrid/models";

// --- fixtures -------------------------------------------------------------

function torrent(partial: Partial<DebridTorrent>): DebridTorrent {
  return {
    id: partial.id ?? "1",
    name: partial.name ?? "Some.Movie.2024.1080p.mkv",
    sizeBytes: partial.sizeBytes ?? 1024 * 1024 * 1024,
    status: partial.status ?? "downloaded",
    infoHash: partial.infoHash ?? null,
    addedAt: partial.addedAt ?? null,
    host: partial.host ?? null,
    progress: partial.progress ?? null,
    debridService: partial.debridService ?? "RD",
  };
}

/** A minimal DebridService stub. `listTorrents` is wired only when provided so
 * we can exercise the "service without listTorrents" branch by omitting it. */
function fakeService(
  serviceType: DebridServiceType,
  listImpl?: () => Promise<DebridTorrent[]>,
): DebridService {
  const svc: Partial<DebridService> = {
    serviceType,
    checkCache: vi.fn(async () => ({})),
    addMagnet: vi.fn(async () => "id"),
    selectFiles: vi.fn(async () => {}),
    getStreamURL: vi.fn(),
    unrestrict: vi.fn(async () => ""),
    validateToken: vi.fn(async () => true),
    getAccountInfo: vi.fn(),
  };
  if (listImpl) svc.listTorrents = vi.fn(listImpl);
  return svc as DebridService;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// --- groupKey edge / boundary --------------------------------------------

describe("groupKey (edges)", () => {
  it("treats an empty-string infoHash as absent and falls back to name+size", () => {
    const t = torrent({ infoHash: "", name: "Movie.mkv", sizeBytes: 1024 * 1024 });
    expect(groupKey(t)).toBe("name:movie:1");
  });

  it("strips only 2-4 char extensions, not longer trailing dotted tokens", () => {
    // ".mkv" (3) is stripped; ".information" (>4) is NOT treated as an extension.
    expect(groupKey(torrent({ infoHash: null, name: "A.mkv", sizeBytes: 0 }))).toBe(
      "name:a:0",
    );
    const long = groupKey(torrent({ infoHash: null, name: "A.information", sizeBytes: 0 }));
    expect(long).toBe("name:a.information:0");
  });

  it("strips a 2-char extension (the lower bound of the strip range)", () => {
    expect(groupKey(torrent({ infoHash: null, name: "Clip.ts", sizeBytes: 0 }))).toBe(
      "name:clip:0",
    );
  });

  it("does not strip a 1-char extension", () => {
    expect(groupKey(torrent({ infoHash: null, name: "File.x", sizeBytes: 0 }))).toBe(
      "name:file.x:0",
    );
  });

  it("rounds size to the nearest MiB so sub-MiB drift groups together", () => {
    const halfMiB = 1024 * 1024 * 0.5; // rounds up to 1
    const justUnder = 1024 * 1024 * 1.49; // rounds down to 1
    expect(groupKey(torrent({ infoHash: null, name: "X.mkv", sizeBytes: halfMiB }))).toBe(
      "name:x:1",
    );
    expect(groupKey(torrent({ infoHash: null, name: "X.mkv", sizeBytes: justUnder }))).toBe(
      "name:x:1",
    );
  });

  it("collapses runs of whitespace and trims for the name segment", () => {
    // Extension strip runs BEFORE whitespace-collapse and is anchored to end-of-
    // string, so a name with a trailing space keeps its ".mkv" (the regex never
    // matches). This documents that ordering.
    expect(
      groupKey(torrent({ infoHash: null, name: "  The   Big   Film.mkv", sizeBytes: 0 })),
    ).toBe("name:the big film:0");
  });

  it("a hash key and a name key never collide for the same logical content", () => {
    const withHash = groupKey(torrent({ infoHash: "abc", name: "X.mkv", sizeBytes: 1 }));
    const withName = groupKey(torrent({ infoHash: null, name: "X.mkv", sizeBytes: 1 }));
    expect(withHash).not.toBe(withName);
    expect(withHash.startsWith("hash:")).toBe(true);
    expect(withName.startsWith("name:")).toBe(true);
  });
});

// --- markDuplicates edge / boundary --------------------------------------

describe("markDuplicates (edges)", () => {
  it("returns an empty array for an empty input", () => {
    expect(markDuplicates([])).toEqual([]);
  });

  it("never flags a single row", () => {
    const rows = markDuplicates([torrent({ id: "solo", infoHash: "h" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isDuplicate).toBe(false);
    expect(rows[0].groupKey).toBe("hash:h");
  });

  it("flags all members of a 3-way hash group", () => {
    const rows = markDuplicates([
      torrent({ id: "1", infoHash: "same" }),
      torrent({ id: "2", infoHash: "same" }),
      torrent({ id: "3", infoHash: "same" }),
    ]);
    expect(rows.every((r) => r.isDuplicate)).toBe(true);
    expect(new Set(rows.map((r) => r.groupKey)).size).toBe(1);
  });

  it("keeps independent groups separate (two distinct dup pairs)", () => {
    const rows = markDuplicates([
      torrent({ id: "a1", infoHash: "A" }),
      torrent({ id: "b1", infoHash: "B" }),
      torrent({ id: "a2", infoHash: "A" }),
      torrent({ id: "b2", infoHash: "B" }),
      torrent({ id: "c1", infoHash: "C" }),
    ]);
    const dupIds = rows.filter((r) => r.isDuplicate).map((r) => r.torrent.id).sort();
    expect(dupIds).toEqual(["a1", "a2", "b1", "b2"]);
    expect(rows.find((r) => r.torrent.id === "c1")?.isDuplicate).toBe(false);
  });

  it("does NOT group a hash-keyed row with a name-keyed row even if name+size match", () => {
    const rows = markDuplicates([
      torrent({ id: "h", infoHash: "deadbeef", name: "Dup.mkv", sizeBytes: 10 ** 9 }),
      torrent({ id: "n", infoHash: null, name: "Dup.mkv", sizeBytes: 10 ** 9 }),
    ]);
    expect(rows.every((r) => !r.isDuplicate)).toBe(true);
  });

  it("preserves input order in the returned rows", () => {
    const rows = markDuplicates([
      torrent({ id: "z" }),
      torrent({ id: "y" }),
      torrent({ id: "x" }),
    ]);
    expect(rows.map((r) => r.torrent.id)).toEqual(["z", "y", "x"]);
  });
});

// --- formatSize boundaries -----------------------------------------------

describe("formatSize (boundaries)", () => {
  it("renders the em-dash sentinel for zero and negative byte counts", () => {
    expect(formatSize(0)).toBe("—");
    expect(formatSize(-1)).toBe("—");
    expect(formatSize(-1024 * 1024)).toBe("—");
  });

  it("uses whole numbers for bytes (unit 0) regardless of magnitude", () => {
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("steps up exactly at 1024 boundaries", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("shows whole numbers (no decimal) once value >= 100 in a unit", () => {
    expect(formatSize(512 * 1024)).toBe("512 KB");
    expect(formatSize(150 * 1024 * 1024)).toBe("150 MB");
  });

  it("keeps one decimal below 100 in a unit", () => {
    expect(formatSize(1024 * 1024 * 1024 * 4.2)).toBe("4.2 GB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("clamps at TB (the largest unit) for very large inputs", () => {
    // Below 100 in-unit keeps one decimal even at the top unit.
    const tenTB = 10 * 1024 ** 4;
    expect(formatSize(tenTB)).toBe("10.0 TB");
    // >= 100 in-unit drops the decimal; a PB-scale input clamps to TB.
    const pb = 1024 ** 5; // would be PB; clamps to TB
    expect(formatSize(pb)).toBe("1024 TB");
  });
});

// --- library listing / transform (the hook's data source) ----------------
//
// useDebridLibrary calls debrid.listTorrents() then markDuplicates(). We drive
// DebridManager.listTorrents with mocked services to exercise the merge/sort/
// fault-tolerant transform, then feed the result through markDuplicates the way
// the hook does, asserting the rows + duplicateCount the hook would compute.

const RD: DebridServiceType = "real_debrid";
const AD: DebridServiceType = "all_debrid";
const PM: DebridServiceType = "premiumize";

describe("DebridManager.listTorrents (library transform)", () => {
  it("returns an empty list when no services are configured", async () => {
    const mgr = new DebridManager();
    expect(mgr.hasServices).toBe(false);
    await expect(mgr.listTorrents()).resolves.toEqual([]);
  });

  it("merges rows across services preserving service (insertion) order", async () => {
    const mgr = new DebridManager();
    mgr.addService(fakeService(RD, async () => [torrent({ id: "rd1", debridService: "RD" })]));
    mgr.addService(fakeService(AD, async () => [torrent({ id: "ad1", debridService: "AD" })]));
    const rows = await mgr.listTorrents();
    expect(rows.map((t) => t.id)).toEqual(["rd1", "ad1"]);
  });

  it("keeps each service's rows grouped together regardless of resolve order", async () => {
    const mgr = new DebridManager();
    // First service resolves slowly; order must still follow insertion order.
    mgr.addService(
      fakeService(RD, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return [torrent({ id: "rd1" }), torrent({ id: "rd2" })];
      }),
    );
    mgr.addService(fakeService(AD, async () => [torrent({ id: "ad1" })]));
    const rows = await mgr.listTorrents();
    expect(rows.map((t) => t.id)).toEqual(["rd1", "rd2", "ad1"]);
  });

  it("is fault-tolerant: a throwing service contributes no rows but does not fail the call", async () => {
    const mgr = new DebridManager();
    mgr.addService(
      fakeService(RD, async () => {
        throw new Error("RD down");
      }),
    );
    mgr.addService(fakeService(AD, async () => [torrent({ id: "ad1" })]));
    const rows = await mgr.listTorrents();
    expect(rows.map((t) => t.id)).toEqual(["ad1"]);
  });

  it("treats a service without a listTorrents method as contributing nothing", async () => {
    const mgr = new DebridManager();
    mgr.addService(fakeService(RD)); // no listTorrents impl
    mgr.addService(fakeService(AD, async () => [torrent({ id: "ad1" })]));
    const rows = await mgr.listTorrents();
    expect(rows.map((t) => t.id)).toEqual(["ad1"]);
  });

  it("yields an empty list when every service returns empty (empty-account branch)", async () => {
    const mgr = new DebridManager();
    mgr.addService(fakeService(RD, async () => []));
    mgr.addService(fakeService(AD, async () => []));
    await expect(mgr.listTorrents()).resolves.toEqual([]);
  });

  it("yields an empty list when every service throws", async () => {
    const mgr = new DebridManager();
    mgr.addService(
      fakeService(RD, async () => {
        throw new Error("boom");
      }),
    );
    mgr.addService(
      fakeService(AD, async () => {
        throw new Error("boom");
      }),
    );
    await expect(mgr.listTorrents()).resolves.toEqual([]);
  });
});

describe("library transform end-to-end (listTorrents -> markDuplicates)", () => {
  it("flags a cross-service duplicate by shared infoHash and counts it", async () => {
    const mgr = new DebridManager();
    mgr.addService(
      fakeService(RD, async () => [
        torrent({ id: "rd1", infoHash: "deadbeef", debridService: "RD" }),
      ]),
    );
    mgr.addService(
      fakeService(AD, async () => [
        torrent({ id: "ad1", infoHash: "deadbeef", debridService: "AD" }),
        torrent({ id: "ad2", infoHash: "unique", debridService: "AD" }),
      ]),
    );

    const torrents = await mgr.listTorrents();
    const rows = markDuplicates(torrents);
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;

    expect(rows.map((r) => r.torrent.id)).toEqual(["rd1", "ad1", "ad2"]);
    expect(duplicateCount).toBe(2);
    expect(rows.find((r) => r.torrent.id === "ad2")?.isDuplicate).toBe(false);
  });

  it("flags a name+size duplicate across services when hashes are absent", async () => {
    const mgr = new DebridManager();
    mgr.addService(
      fakeService(RD, async () => [
        torrent({ id: "rd1", infoHash: null, name: "The Film.mkv", sizeBytes: 10 ** 9 }),
      ]),
    );
    mgr.addService(
      fakeService(PM, async () => [
        torrent({ id: "pm1", infoHash: null, name: "the film.mp4", sizeBytes: 10 ** 9 }),
      ]),
    );

    const rows = markDuplicates(await mgr.listTorrents());
    expect(rows.every((r) => r.isDuplicate)).toBe(true);
    expect(rows.filter((r) => r.isDuplicate)).toHaveLength(2);
  });

  it("produces zero duplicates for a clean library", async () => {
    const mgr = new DebridManager();
    mgr.addService(
      fakeService(RD, async () => [
        torrent({ id: "rd1", infoHash: "a" }),
        torrent({ id: "rd2", infoHash: "b" }),
      ]),
    );
    const rows = markDuplicates(await mgr.listTorrents());
    expect(rows.filter((r) => r.isDuplicate)).toHaveLength(0);
  });

  it("empty library yields empty rows and a zero duplicate count", async () => {
    const mgr = new DebridManager();
    mgr.addService(fakeService(RD, async () => []));
    const rows = markDuplicates(await mgr.listTorrents());
    expect(rows).toEqual([]);
    expect(rows.filter((r) => r.isDuplicate).length).toBe(0);
  });
});
