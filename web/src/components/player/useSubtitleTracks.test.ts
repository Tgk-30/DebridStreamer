// @vitest-environment jsdom
//
// useSubtitleTracks: add/setActive/setDelay/search/loadResult/translate paths,
// plus the gated (no-client / no-translator) states and object-URL cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSubtitleTracks } from "./useSubtitleTracks";
import type {
  SubtitleClient,
  SubtitleSearchResult,
} from "../../services/subtitles/OpenSubtitlesClient";
import type { Translator } from "../../services/subtitles/SubtitleTranslator";
import type { SubtitleCue } from "../../services/subtitles/cues";

// A minimal SRT blob parseSubtitles can handle, so loadResult produces 1 cue.
const SAMPLE_SRT = "1\n00:00:01,000 --> 00:00:02,000\nHello world\n";

function makeResult(over: Partial<SubtitleSearchResult> = {}): SubtitleSearchResult {
  return {
    fileId: "file-1",
    language: "en",
    release: "Some.Release.720p",
    downloadCount: 100,
    hearingImpaired: false,
    machineTranslated: false,
    fps: null,
    ...over,
  };
}

function makeClient(over: Partial<SubtitleClient> = {}): SubtitleClient {
  return {
    hasKey: true,
    search: vi.fn(async () => [makeResult()]),
    download: vi.fn(async () => SAMPLE_SRT),
    ...over,
  } as SubtitleClient;
}

let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  // jsdom doesn't implement these; stub them so makeVttUrl works and we can
  // assert revocation.
  createObjectURLSpy = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:mock-${++urlCounter}`);
  revokeObjectURLSpy = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSubtitleTracks gating", () => {
  it("canSearch/canTranslate reflect client.hasKey and translator.available", () => {
    const { result } = renderHook(() =>
      useSubtitleTracks(makeClient({ hasKey: false }), null),
    );
    expect(result.current.canSearch).toBe(false);
    expect(result.current.canTranslate).toBe(false);

    const { result: r2 } = renderHook(() =>
      useSubtitleTracks(makeClient({ hasKey: true }), {
        available: true,
        translate: vi.fn(),
      } as unknown as Translator),
    );
    expect(r2.current.canSearch).toBe(true);
    expect(r2.current.canTranslate).toBe(true);
  });

  it("canSearch is false when client is null", () => {
    const { result } = renderHook(() => useSubtitleTracks(null, null));
    expect(result.current.canSearch).toBe(false);
    expect(result.current.canTranslate).toBe(false);
  });
});

describe("search", () => {
  it("sets the configure-key error when the client is null", async () => {
    const { result } = renderHook(() => useSubtitleTracks(null, null));
    await act(async () => {
      await result.current.search({ query: "x", languages: ["en"] });
    });
    expect(result.current.searchError).toBe(
      "Add an OpenSubtitles API key in Settings.",
    );
    expect(result.current.results).toEqual([]);
  });

  it("sets a friendly error and does not call client when no key", async () => {
    const client = makeClient({ hasKey: false });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.search({ query: "x", languages: ["en"] });
    });
    expect(result.current.searchError).toBe(
      "Add an OpenSubtitles API key in Settings.",
    );
    expect(client.search).not.toHaveBeenCalled();
  });

  it("populates results on success", async () => {
    const client = makeClient({ search: vi.fn(async () => [makeResult()]) });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.search({ imdbId: "tt123", languages: ["en"] });
    });
    expect(result.current.results).toHaveLength(1);
    expect(result.current.searchError).toBeNull();
    expect(result.current.searching).toBe(false);
  });

  it("sets 'No subtitles found.' on empty results", async () => {
    const client = makeClient({ search: vi.fn(async () => []) });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.search({ query: "x", languages: ["en"] });
    });
    expect(result.current.results).toHaveLength(0);
    expect(result.current.searchError).toBe("No subtitles found.");
  });

  it("captures the error message and clears results when search throws", async () => {
    const client = makeClient({
      search: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.search({ query: "x", languages: ["en"] });
    });
    expect(result.current.searchError).toBe("boom");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
  });

  it("uses a default message when search throws a non-Error value", async () => {
    const client = makeClient({
      search: vi.fn(async () => {
        throw "search down";
      }),
    });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.search({ query: "x", languages: ["en"] });
    });
    expect(result.current.searchError).toBe("Search failed.");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
  });
});

describe("loadResult / addTrack", () => {
  it("no-ops when client is null", async () => {
    const { result } = renderHook(() => useSubtitleTracks(null, null));
    await act(async () => {
      await result.current.loadResult(makeResult());
    });
    expect(result.current.tracks).toHaveLength(0);
  });

  it("downloads, parses, adds a track, and makes it active", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    // last-search imdb id is forwarded to download(); seed it via a search.
    await act(async () => {
      await result.current.search({ imdbId: "tt999", languages: ["en"] });
    });
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "file-1" }));
    });
    expect(client.download).toHaveBeenCalledWith("file-1", "tt999");
    expect(result.current.tracks).toHaveLength(1);
    const t = result.current.tracks[0];
    expect(t.id).toBe("os-file-1");
    expect(t.translated).toBe(false);
    expect(t.delayMs).toBe(0);
    expect(t.vttUrl).toMatch(/^blob:mock-/);
    expect(result.current.activeTrackId).toBe("os-file-1");
    expect(result.current.loadingFileId).toBeNull();
  });

  it("sets an error when the downloaded subtitle parses to no cues", async () => {
    const client = makeClient({ download: vi.fn(async () => "not a subtitle") });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult());
    });
    expect(result.current.tracks).toHaveLength(0);
    expect(result.current.searchError).toBe(
      "Subtitle file was empty or unreadable.",
    );
  });

  it("sets a download error and clears loadingFileId when download throws", async () => {
    const client = makeClient({
      download: vi.fn(async () => {
        throw new Error("net down");
      }),
    });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult());
    });
    expect(result.current.searchError).toBe("net down");
    expect(result.current.loadingFileId).toBeNull();
  });

  it("uses a default message when download throws a non-Error value", async () => {
    const client = makeClient({
      download: vi.fn(async () => {
        throw "download failed";
      }),
    });
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult());
    });
    expect(result.current.searchError).toBe("Download failed.");
    expect(result.current.loadingFileId).toBeNull();
  });
});

describe("setActiveTrack & setDelay", () => {
  it("setActiveTrack toggles the active id", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    act(() => result.current.setActiveTrack(null));
    expect(result.current.activeTrackId).toBeNull();
    act(() => result.current.setActiveTrack("os-f"));
    expect(result.current.activeTrackId).toBe("os-f");
  });

  it("setDelay updates delayMs, revokes the old URL, and makes a new one", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    const oldUrl = result.current.tracks[0].vttUrl;
    act(() => result.current.setDelay("os-f", 250));
    expect(result.current.tracks[0].delayMs).toBe(250);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(oldUrl);
    expect(result.current.tracks[0].vttUrl).not.toBe(oldUrl);
  });

  it("setDelay on an unknown track id leaves tracks unchanged", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    const before = result.current.tracks[0];
    act(() => result.current.setDelay("nope", 1000));
    expect(result.current.tracks[0]).toBe(before);
  });
});

describe("translateTrack", () => {
  const cue: SubtitleCue = { start: 0, end: 1000, text: "Hi" };

  it("no-ops when translator is null", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, null));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    await act(async () => {
      await result.current.translateTrack("os-f", "Spanish");
    });
    // No new track added (still only the loaded one).
    expect(result.current.tracks).toHaveLength(1);
  });

  it("no-ops when translator.available is false", async () => {
    const translator: Translator = {
      available: false,
      translate: vi.fn(),
    };
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, translator));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    await act(async () => {
      await result.current.translateTrack("os-f", "Spanish");
    });
    expect(translator.translate).not.toHaveBeenCalled();
    expect(result.current.tracks).toHaveLength(1);
  });

  it("no-ops when the source track id is unknown", async () => {
    const translator: Translator = {
      available: true,
      translate: vi.fn(async () => [cue]),
    };
    const { result } = renderHook(() => useSubtitleTracks(makeClient(), translator));
    await act(async () => {
      await result.current.translateTrack("missing", "Spanish");
    });
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("translates the source cues and appends a translated track, reporting progress", async () => {
    const translatedCues: SubtitleCue[] = [{ start: 0, end: 1000, text: "Hola" }];
    const translator: Translator = {
      available: true,
      translate: vi.fn(async (_cues, _lang, onProgress) => {
        onProgress?.(1, 2);
        return translatedCues;
      }),
    };
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, translator));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f", language: "en" }));
    });
    await act(async () => {
      await result.current.translateTrack("os-f", "Spanish");
    });
    expect(translator.translate).toHaveBeenCalledTimes(1);
    expect(result.current.tracks).toHaveLength(2);
    const added = result.current.tracks[1];
    expect(added.translated).toBe(true);
    expect(added.language).toBe("Spanish");
    expect(added.label).toContain("Spanish (AI)");
    expect(added.label).toContain("EN");
    // The newly-added track becomes active and progress/flag are reset.
    expect(result.current.activeTrackId).toBe(added.id);
    expect(result.current.translatingTrackId).toBeNull();
    expect(result.current.translateProgress).toBeNull();
  });

  it("resets translatingTrackId even when translate rejects", async () => {
    const translator: Translator = {
      available: true,
      translate: vi.fn(async () => {
        throw new Error("ai down");
      }),
    };
    const client = makeClient();
    const { result } = renderHook(() => useSubtitleTracks(client, translator));
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    await act(async () => {
      await expect(
        result.current.translateTrack("os-f", "Spanish"),
      ).rejects.toThrow("ai down");
    });
    expect(result.current.translatingTrackId).toBeNull();
    expect(result.current.translateProgress).toBeNull();
    expect(result.current.tracks).toHaveLength(1);
  });
});

describe("URL cleanup on unmount", () => {
  it("revokes every created object URL when the hook unmounts", async () => {
    const client = makeClient();
    const { result, unmount } = renderHook(() =>
      useSubtitleTracks(client, null),
    );
    await act(async () => {
      await result.current.loadResult(makeResult({ fileId: "f" }));
    });
    const createdCount = createObjectURLSpy.mock.calls.length;
    expect(createdCount).toBeGreaterThan(0);
    revokeObjectURLSpy.mockClear();
    unmount();
    // The remaining (non-yet-revoked) URL gets revoked on unmount.
    await waitFor(() => expect(revokeObjectURLSpy).toHaveBeenCalled());
  });
});
