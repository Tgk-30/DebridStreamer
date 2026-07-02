// Shared onboarding help — plain-language definitions of the app's core concepts
// and pointers to where a new user gets each key. Kept as data (no UI, no deps)
// so onboarding, Settings, and the empty states can all speak with one voice.

export interface Concept {
  term: string;
  /** One-sentence, jargon-light explanation for a non-technical user. */
  blurb: string;
}

export const CONCEPTS = {
  debrid: {
    term: "Debrid service",
    blurb:
      "A subscription (Real-Debrid, TorBox, Premiumize or AllDebrid) that keeps popular releases ready and streams them to you as instant, direct links — no downloading or seeding.",
  },
  source: {
    term: "Source",
    blurb:
      "Where the app looks for releases. Turn on the built-in scrapers, add a Torznab/Jackett/Prowlarr URL, or plug in a Stremio add-on like Torrentio.",
  },
  cached: {
    term: "Cached stream",
    blurb:
      "A release your debrid service already has ready — it plays in seconds. A green “Instant” badge marks these; the rest cache on demand.",
  },
  tmdb: {
    term: "TMDB key",
    blurb:
      "A free key from The Movie Database that powers search, artwork, and recommendations.",
  },
} as const;

export type ConceptKey = keyof typeof CONCEPTS;

export interface SignupLink {
  id: string;
  label: string;
  url: string;
  kind: "metadata" | "debrid" | "subtitles";
}

/** Where to sign up / find each key. Opened in a new tab from the field's help. */
export const SIGNUP_LINKS: readonly SignupLink[] = [
  {
    id: "tmdb",
    label: "Get a free TMDB key",
    url: "https://www.themoviedb.org/settings/api",
    kind: "metadata",
  },
  {
    id: "realDebrid",
    label: "Real-Debrid API token",
    url: "https://real-debrid.com/apitoken",
    kind: "debrid",
  },
  {
    id: "torbox",
    label: "TorBox account",
    url: "https://torbox.app",
    kind: "debrid",
  },
  {
    id: "premiumize",
    label: "Premiumize account",
    url: "https://www.premiumize.me/account",
    kind: "debrid",
  },
  {
    id: "allDebrid",
    label: "AllDebrid API keys",
    url: "https://alldebrid.com/apikeys",
    kind: "debrid",
  },
  {
    id: "openSubtitles",
    label: "OpenSubtitles account",
    url: "https://www.opensubtitles.com/en/consumers",
    kind: "subtitles",
  },
];

/** DebridServiceType value → SIGNUP_LINKS id. (Settings.tsx and
 *  ServerSetupWizard.tsx carry local copies today — dedupe onto this later.) */
export const DEBRID_SIGNUP_ID: Record<string, string> = {
  real_debrid: "realDebrid",
  all_debrid: "allDebrid",
  premiumize: "premiumize",
  torbox: "torbox",
};

/** Look up a signup URL by id (e.g. "tmdb", "realDebrid"); null if unknown. */
export function signupUrl(id: string): string | null {
  return SIGNUP_LINKS.find((l) => l.id === id)?.url ?? null;
}
