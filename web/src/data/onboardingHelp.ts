// Shared onboarding help - plain-language definitions of the app's core concepts
// and pointers to where a new user gets each key. Kept as data (no UI, no deps)
// so onboarding, Settings, and the empty states can all speak with one voice.

export const CONCEPTS = {
  debrid: {
    term: "Debrid service",
    blurb:
      "A subscription (TorBox, Real-Debrid, Premiumize or AllDebrid) that keeps popular releases ready and streams them to you as instant, direct links - no downloading or seeding.",
  },
  source: {
    term: "Source",
    blurb:
      "Where the app looks for releases. Turn on the built-in scrapers, add a Torznab/Jackett/Prowlarr URL, or plug in a Stremio add-on like Torrentio.",
  },
  cached: {
    term: "Cached stream",
    blurb:
      "A release your debrid service already has ready - it plays in seconds. A green “Instant” badge marks these; the rest cache on demand.",
  },
  tmdb: {
    term: "TMDB key",
    blurb:
      "A free key from The Movie Database that powers search, artwork, and recommendations.",
  },
  omdb: {
    term: "OMDb key",
    blurb:
      "A free key from the Open Movie Database that adds IMDb and Rotten Tomatoes ratings and basic lookups.",
  },
} as const;


interface SignupLink {
  id: string;
  label: string;
  url: string;
  kind: "metadata" | "debrid" | "subtitles" | "ai";
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
    id: "omdb",
    label: "Get a free OMDb key",
    url: "https://www.omdbapi.com/apikey.aspx",
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
  {
    id: "anthropic",
    label: "Anthropic API key",
    url: "https://console.anthropic.com/settings/keys",
    kind: "ai",
  },
  {
    id: "openai",
    label: "OpenAI API key",
    url: "https://platform.openai.com/api-keys",
    kind: "ai",
  },
  {
    id: "gemini",
    label: "Google Gemini API key",
    url: "https://aistudio.google.com/apikey",
    kind: "ai",
  },
  {
    id: "openrouter",
    label: "OpenRouter API key",
    url: "https://openrouter.ai/keys",
    kind: "ai",
  },
  {
    id: "groq",
    label: "Groq API key",
    url: "https://console.groq.com/keys",
    kind: "ai",
  },
  {
    id: "mistral",
    label: "Mistral API key",
    url: "https://console.mistral.ai/api-keys",
    kind: "ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek API key",
    url: "https://platform.deepseek.com/api_keys",
    kind: "ai",
  },
  {
    id: "xai",
    label: "xAI (Grok) API key",
    url: "https://console.x.ai",
    kind: "ai",
  },
];

/** DebridServiceType value → SIGNUP_LINKS id. (Settings.tsx and
 *  ServerSetupWizard.tsx carry local copies today - dedupe onto this later.) */
export const DEBRID_SIGNUP_ID: Record<string, string> = {
  real_debrid: "realDebrid",
  all_debrid: "allDebrid",
  premiumize: "premiumize",
  torbox: "torbox",
};

/** AIProviderKind value → SIGNUP_LINKS id. Ollama runs locally (no signup). */
export const AI_SIGNUP_ID: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "gemini",
  openrouter: "openrouter",
  groq: "groq",
  mistral: "mistral",
  deepseek: "deepseek",
  xai: "xai",
};

/** Look up a signup URL by id (e.g. "tmdb", "realDebrid"); null if unknown. */
export function signupUrl(id: string): string | null {
  return SIGNUP_LINKS.find((l) => l.id === id)?.url ?? null;
}

/** A "watch how to set this up" YouTube link per service. Deliberately a YouTube
 *  SEARCH URL (not a single video id) so it always resolves to current, relevant
 *  walkthroughs and can never 404 when a creator takes a video down. */
const SETUP_VIDEOS: Record<string, string> = {
  tmdb: "https://www.youtube.com/results?search_query=how+to+get+a+tmdb+api+key",
  omdb: "https://www.youtube.com/results?search_query=how+to+get+an+omdb+api+key",
  torbox: "https://www.youtube.com/results?search_query=how+to+set+up+torbox+api",
  realDebrid:
    "https://www.youtube.com/results?search_query=how+to+set+up+real-debrid+api",
  allDebrid:
    "https://www.youtube.com/results?search_query=how+to+set+up+alldebrid+api",
  premiumize:
    "https://www.youtube.com/results?search_query=how+to+set+up+premiumize+api",
};

/** Look up a YouTube setup-walkthrough URL by id (e.g. "tmdb", "realDebrid"). */
export function setupVideoUrl(id: string): string | null {
  return SETUP_VIDEOS[id] ?? null;
}
