// Tests for the debrid-library dedup + formatting helpers (pure).

import { describe, expect, it } from "vitest";
import { groupKey, markDuplicates, formatSize } from "./debridLibrary";
import type { DebridTorrent } from "../services/debrid/models";

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

describe("groupKey", () => {
  it("uses the infoHash when present", () => {
    expect(groupKey(torrent({ infoHash: "abc123" }))).toBe("hash:abc123");
  });

  it("falls back to a normalized name + rounded size", () => {
    const t = torrent({ infoHash: null, name: "Some Movie.MKV", sizeBytes: 1024 * 1024 * 100 });
    expect(groupKey(t)).toBe("name:some movie:100");
  });

  it("groups two name+size matches even with case/whitespace drift", () => {
    const a = torrent({ infoHash: null, name: "The   Film.mkv", sizeBytes: 5_000_000 });
    const b = torrent({ infoHash: null, name: "THE FILM.MP4", sizeBytes: 5_000_000 });
    expect(groupKey(a)).toBe(groupKey(b));
  });
});

describe("markDuplicates", () => {
  it("flags rows that share a hash group", () => {
    const rows = markDuplicates([
      torrent({ id: "1", infoHash: "deadbeef" }),
      torrent({ id: "2", infoHash: "deadbeef" }),
      torrent({ id: "3", infoHash: "cafe" }),
    ]);
    expect(rows.filter((r) => r.isDuplicate).map((r) => r.torrent.id)).toEqual(["1", "2"]);
    expect(rows.find((r) => r.torrent.id === "3")?.isDuplicate).toBe(false);
  });

  it("flags name+size duplicates when hashes are absent", () => {
    const rows = markDuplicates([
      torrent({ id: "1", infoHash: null, name: "Dup.mkv", sizeBytes: 10 ** 9 }),
      torrent({ id: "2", infoHash: null, name: "dup.MP4", sizeBytes: 10 ** 9 }),
    ]);
    expect(rows.every((r) => r.isDuplicate)).toBe(true);
  });

  it("returns no duplicates for a unique list", () => {
    const rows = markDuplicates([
      torrent({ id: "1", infoHash: "a" }),
      torrent({ id: "2", infoHash: "b" }),
    ]);
    expect(rows.some((r) => r.isDuplicate)).toBe(false);
  });
});

describe("formatSize", () => {
  it("formats common sizes", () => {
    expect(formatSize(0)).toBe("—");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024 * 1024 * 1024 * 4.2)).toBe("4.2 GB");
  });
});
