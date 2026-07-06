import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSubtitlesClient } from "./ServerSubtitlesClient";
import type {
  SubtitleSearchResult,
  SubtitleSearchParams,
} from "./OpenSubtitlesClient";

const searchServerSubtitles = vi.fn<
  (params: SubtitleSearchParams) => Promise<{ results: SubtitleSearchResult[] }>
>();

const fetchServerSubtitle = vi.fn<(fileId: string, imdbId?: string | null) => Promise<{ vtt: string }>>();

vi.mock("../../lib/serverApi", () => ({
  searchServerSubtitles: (params: SubtitleSearchParams) =>
    searchServerSubtitles(params),
  fetchServerSubtitle: (fileId: string, imdbId?: string | null) =>
    fetchServerSubtitle(fileId, imdbId),
}));

beforeEach(() => {
  searchServerSubtitles.mockReset();
  fetchServerSubtitle.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ServerSubtitlesClient", () => {
  it("always reports key availability", () => {
    expect(new ServerSubtitlesClient().hasKey).toBe(true);
  });

  it("forwards search params and returns rows", async () => {
    const expected = [{ fileId: "99", language: "en", release: "release", downloadCount: 3, hearingImpaired: false, machineTranslated: false, fps: null }];
    searchServerSubtitles.mockResolvedValue({ results: expected });
    const client = new ServerSubtitlesClient();

    const params: SubtitleSearchParams = { imdbId: "tt1" };
    const results = await client.search(params);
    expect(searchServerSubtitles).toHaveBeenCalledWith(params);
    expect(results).toEqual(expected);
  });

  it("forwards file id and imdb id to fetchServerSubtitle and returns vtt", async () => {
    fetchServerSubtitle.mockResolvedValue({ vtt: "WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi" });
    const client = new ServerSubtitlesClient();
    const vtt = await client.download("abc", "tt123");

    expect(fetchServerSubtitle).toHaveBeenCalledWith("abc", "tt123");
    expect(vtt).toBe("WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi");
  });

  it("forwards an undefined imdb id as undefined", async () => {
    fetchServerSubtitle.mockResolvedValue({ vtt: "WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi" });
    const client = new ServerSubtitlesClient();

    await client.download("abc");
    expect(fetchServerSubtitle).toHaveBeenCalledWith("abc", undefined);
  });
});
