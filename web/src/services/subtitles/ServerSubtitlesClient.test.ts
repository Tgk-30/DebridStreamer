import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSubtitlesClient } from "./ServerSubtitlesClient";
import type {
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "./OpenSubtitlesClient";

const searchServerSubtitles = vi.fn<
  (params: SubtitleSearchParams) => Promise<{ results: SubtitleSearchResult[] }>
>();
const fetchServerSubtitle = vi.fn<
  (fileId: string, imdbId?: string | null) => Promise<{ vtt: string }>
>();

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
  it("always reports key availability when the server manages the key", () => {
    expect(new ServerSubtitlesClient().hasKey).toBe(true);
  });

  it("forwards search params and returns server rows", async () => {
    const expected: SubtitleSearchResult[] = [
      {
        fileId: "99",
        language: "en",
        release: "release",
        downloadCount: 3,
        hearingImpaired: false,
        machineTranslated: false,
        fps: null,
      },
    ];
    searchServerSubtitles.mockResolvedValue({ results: expected });
    const params: SubtitleSearchParams = { imdbId: "tt1" };

    await expect(new ServerSubtitlesClient().search(params)).resolves.toEqual(
      expected,
    );
    expect(searchServerSubtitles).toHaveBeenCalledWith(params);
  });

  it("forwards a file and IMDb id and returns VTT", async () => {
    const vtt = "WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi";
    fetchServerSubtitle.mockResolvedValue({ vtt });

    await expect(
      new ServerSubtitlesClient().download("abc", "tt123"),
    ).resolves.toBe(vtt);
    expect(fetchServerSubtitle).toHaveBeenCalledWith("abc", "tt123");
  });

  it("forwards an omitted IMDb id as undefined", async () => {
    fetchServerSubtitle.mockResolvedValue({ vtt: "WEBVTT" });

    await new ServerSubtitlesClient().download("abc");

    expect(fetchServerSubtitle).toHaveBeenCalledWith("abc", undefined);
  });
});
