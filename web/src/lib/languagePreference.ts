/**
 * Language preference helpers shared by player backends. Track metadata is
 * provider-controlled, so every entry point accepts unknown values and fails
 * closed instead of changing the stream-selected track.
 */

export type CanonicalLanguage = string;

export interface PlaybackLanguageOption {
  value: CanonicalLanguage;
  label: string;
}

/** Languages exposed by the playback settings selectors. */
export const PLAYBACK_LANGUAGE_OPTIONS: readonly PlaybackLanguageOption[] = [
  { value: "ar", label: "Arabic" },
  { value: "bn", label: "Bengali" },
  { value: "bg", label: "Bulgarian" },
  { value: "ca", label: "Catalan" },
  { value: "zh", label: "Chinese" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ms", label: "Malay" },
  { value: "no", label: "Norwegian" },
  { value: "fa", label: "Persian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sr", label: "Serbian" },
  { value: "sk", label: "Slovak" },
  { value: "es", label: "Spanish" },
  { value: "sv", label: "Swedish" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "vi", label: "Vietnamese" },
] as const;

const LANGUAGE_ALIASES: Readonly<Record<string, CanonicalLanguage>> = {
  ar: "ar", ara: "ar", arabic: "ar",
  bn: "bn", ben: "bn", bengali: "bn",
  bg: "bg", bul: "bg", bulgarian: "bg",
  ca: "ca", cat: "ca", catalan: "ca",
  cs: "cs", ces: "cs", cze: "cs", czech: "cs",
  da: "da", dan: "da", danish: "da",
  de: "de", deu: "de", ger: "de", german: "de", deutsch: "de",
  el: "el", ell: "el", gre: "el", greek: "el",
  en: "en", eng: "en", english: "en", ingles: "en",
  es: "es", spa: "es", spanish: "es", espanol: "es", castellano: "es",
  fa: "fa", fas: "fa", per: "fa", persian: "fa", farsi: "fa",
  fi: "fi", fin: "fi", finnish: "fi",
  fr: "fr", fra: "fr", fre: "fr", french: "fr", francais: "fr",
  he: "he", heb: "he", iw: "he", hebrew: "he",
  hi: "hi", hin: "hi", hindi: "hi",
  hr: "hr", hrv: "hr", croatian: "hr",
  hu: "hu", hun: "hu", hungarian: "hu",
  id: "id", ind: "id", indonesian: "id",
  it: "it", ita: "it", italian: "it", italiano: "it",
  ja: "ja", jpn: "ja", japanese: "ja", nihongo: "ja",
  ko: "ko", kor: "ko", korean: "ko", hangul: "ko",
  ms: "ms", msa: "ms", may: "ms", malay: "ms",
  nl: "nl", nld: "nl", dut: "nl", dutch: "nl",
  no: "no", nor: "no", norwegian: "no",
  pl: "pl", pol: "pl", polish: "pl",
  pt: "pt", por: "pt", portuguese: "pt", portugues: "pt",
  ro: "ro", ron: "ro", rum: "ro", romanian: "ro",
  ru: "ru", rus: "ru", russian: "ru",
  sk: "sk", slk: "sk", slo: "sk", slovak: "sk",
  sr: "sr", srp: "sr", serbian: "sr",
  sv: "sv", swe: "sv", swedish: "sv",
  ta: "ta", tam: "ta", tamil: "ta",
  te: "te", tel: "te", telugu: "te",
  th: "th", tha: "th", thai: "th",
  tr: "tr", tur: "tr", turkish: "tr",
  uk: "uk", ukr: "uk", ukrainian: "uk",
  ur: "ur", urd: "ur", urdu: "ur",
  vi: "vi", vie: "vi", vietnamese: "vi",
  zh: "zh", zho: "zh", chi: "zh", chinese: "zh", mandarin: "zh", cantonese: "zh",
};

const MISSING_LANGUAGE_VALUES = new Set([
  "und",
  "unknown",
  "none",
  "null",
  "n/a",
  "na",
  "original",
  "default",
]);

/**
 * Canonicalizes ISO 639-1, ISO 639-2/B and T, BCP-47 tags, display names, and
 * common aliases. Unknown and malformed metadata deliberately returns null.
 */
export function normalizeLanguagePreference(value: unknown): CanonicalLanguage | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, "-");
  if (!normalized || normalized.length > 128 || MISSING_LANGUAGE_VALUES.has(normalized)) {
    return null;
  }

  const direct = LANGUAGE_ALIASES[normalized];
  if (direct != null) return direct;

  // BCP-47 begins with the base language. Reject non-language leading tokens.
  const bcp47Base = normalized.match(/^([a-z]{2,3})(?:-[a-z0-9]{1,8})+$/)?.[1];
  if (bcp47Base != null) return LANGUAGE_ALIASES[bcp47Base] ?? null;

  // Track names commonly look like "English 5.1" or "French (forced)".
  // Token matching avoids treating arbitrary garbage such as "engagement" as
  // a language.
  const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
  for (const token of tokens) {
    const language = LANGUAGE_ALIASES[token];
    if (language != null) return language;
  }
  return null;
}

/**
 * Finds the first track whose language matches a saved default. It never
 * throws, including when a player adapter gives us malformed metadata.
 */
export function findPreferredLanguageMatch<T>(
  preference: unknown,
  tracks: readonly T[] | null | undefined,
  getLanguage: (track: T) => unknown,
): T | null {
  const wanted = normalizeLanguagePreference(preference);
  if (wanted == null || !Array.isArray(tracks)) return null;
  for (const track of tracks) {
    try {
      if (normalizeLanguagePreference(getLanguage(track)) === wanted) return track;
    } catch {
      // A malformed player adapter must not interrupt playback selection.
    }
  }
  return null;
}
