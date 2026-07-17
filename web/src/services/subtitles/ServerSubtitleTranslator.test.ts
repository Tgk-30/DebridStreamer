import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSubtitleTranslator } from "./ServerSubtitleTranslator";
import type { SubtitleCue } from "./cues";

const translateServerSubtitles = vi.fn<
  (input: { cues: SubtitleCue[]; targetLanguage: string }) => Promise<{
    cues: SubtitleCue[];
    providerKind: string;
  }>
>();

vi.mock("../../lib/serverApi", () => ({
  translateServerSubtitles: (input: {
    cues: SubtitleCue[];
    targetLanguage: string;
  }) => translateServerSubtitles(input),
}));

const cues: SubtitleCue[] = [
  { start: 0, end: 1000, text: "Hello" },
  { start: 1000, end: 2000, text: "World" },
];

beforeEach(() => {
  translateServerSubtitles.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ServerSubtitleTranslator", () => {
  it("is always available when the server manages the key", () => {
    expect(new ServerSubtitleTranslator().available).toBe(true);
  });

  it("forwards cues to the server and reports coarse progress", async () => {
    const translated: SubtitleCue[] = [
      { start: 0, end: 1000, text: "Hola" },
      { start: 1000, end: 2000, text: "Mundo" },
    ];
    translateServerSubtitles.mockResolvedValue({
      cues: translated,
      providerKind: "local",
    });
    const onProgress = vi.fn<(done: number, total: number) => void>();

    const out = await new ServerSubtitleTranslator().translate(
      cues,
      "Spanish",
      onProgress,
    );

    expect(translateServerSubtitles).toHaveBeenCalledWith({
      cues,
      targetLanguage: "Spanish",
    });
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 1);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1, 1);
    expect(out).toEqual(translated);
  });

  it("returns translated cues without a progress callback", async () => {
    translateServerSubtitles.mockResolvedValue({
      cues: [{ start: 0, end: 1000, text: "Salut" }],
      providerKind: "local",
    });

    const out = await new ServerSubtitleTranslator().translate(
      [{ start: 0, end: 1000, text: "Hi" }],
      "French",
    );

    expect(out[0].text).toBe("Salut");
  });
});
