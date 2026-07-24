import { describe, expect, it } from "vitest";
import {
  findPreferredLanguageMatch,
  normalizeLanguagePreference,
  PLAYBACK_LANGUAGE_OPTIONS,
} from "./languagePreference";

describe("normalizeLanguagePreference", () => {
  it("normalizes ISO 639-1, ISO 639-2/B and T, BCP-47, and names", () => {
    expect(normalizeLanguagePreference("en")).toBe("en");
    expect(normalizeLanguagePreference("eng")).toBe("en");
    expect(normalizeLanguagePreference("EN_us")).toBe("en");
    expect(normalizeLanguagePreference("French (Canada)")).toBe("fr");
    expect(normalizeLanguagePreference("fre")).toBe("fr");
    expect(normalizeLanguagePreference("deu")).toBe("de");
    expect(normalizeLanguagePreference("ger")).toBe("de");
    expect(normalizeLanguagePreference("Español Latino")).toBe("es");
    expect(normalizeLanguagePreference("pt-BR")).toBe("pt");
    expect(normalizeLanguagePreference("zho-Hans")).toBe("zh");
    expect(normalizeLanguagePreference("Farsi")).toBe("fa");
    expect(normalizeLanguagePreference("urd")).toBe("ur");
    expect(normalizeLanguagePreference("Bengali")).toBe("bn");
    expect(normalizeLanguagePreference("tam")).toBe("ta");
    expect(normalizeLanguagePreference("te-IN")).toBe("te");
  });

  it("rejects missing, garbage, and ambiguous stream-default values", () => {
    for (const value of [undefined, null, "", "  ", "und", "original", "unknown", "engagement", "x-private", "💥"]) {
      expect(normalizeLanguagePreference(value)).toBeNull();
    }
  });
});

describe("PLAYBACK_LANGUAGE_OPTIONS", () => {
  it("exposes every supported canonical language in alphabetical label order", () => {
    const labels = PLAYBACK_LANGUAGE_OPTIONS.map((option) => option.label);
    expect(labels).toEqual([...labels].sort());
    expect(PLAYBACK_LANGUAGE_OPTIONS).toHaveLength(39);
    expect(PLAYBACK_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        "ar", "bn", "bg", "ca", "zh", "hr", "cs", "da", "nl", "en",
        "fi", "fr", "de", "el", "he", "hi", "hu", "id", "it", "ja",
        "ko", "ms", "no", "fa", "pl", "pt", "ro", "ru", "sr", "sk",
        "es", "sv", "ta", "te", "th", "tr", "uk", "ur", "vi",
      ]),
    );
  });
});

describe("findPreferredLanguageMatch", () => {
  it("matches normalized track metadata and retains the source ordering", () => {
    const tracks = [
      { id: "1", lang: "Japanese" },
      { id: "2", lang: "eng-US" },
      { id: "3", lang: "English commentary" },
    ];

    expect(findPreferredLanguageMatch("English", tracks, (track) => track.lang)).toEqual(tracks[1]);
    expect(findPreferredLanguageMatch("ja", tracks, (track) => track.lang)).toEqual(tracks[0]);
  });

  it("returns no match without throwing for malformed tracks or adapters", () => {
    expect(findPreferredLanguageMatch("en", null, () => "en")).toBeNull();
    expect(findPreferredLanguageMatch("en", [{ id: "1" }], () => {
      throw new Error("bad metadata");
    })).toBeNull();
    expect(findPreferredLanguageMatch("original", [{ id: "1" }], () => "en")).toBeNull();
  });
});
