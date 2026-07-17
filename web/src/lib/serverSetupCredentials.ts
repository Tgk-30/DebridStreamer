import type { ServerCredentialProvider } from "./serverApi";

interface ServerSetupKeyField {
  provider: ServerCredentialProvider;
  label: string;
  hint: string;
  placeholder: string;
}

export type DebridCredentialProvider = Extract<
  ServerCredentialProvider,
  "real_debrid" | "torbox" | "premiumize" | "all_debrid"
>;

interface DebridProviderOption {
  provider: DebridCredentialProvider;
  label: string;
  placeholder: string;
}

interface ServerSetupCredentialDraft {
  provider: ServerCredentialProvider;
  label: string;
  value: string;
}

// Non-debrid keys the setup wizard offers after the dedicated debrid provider
// selector. Debrid uses its own selector so a TorBox/Premiumize token is not
// accidentally saved under the Real-Debrid credential slot.
export const SERVER_SETUP_KEY_FIELDS: ServerSetupKeyField[] = [
  {
    provider: "tmdb",
    label: "TMDB API key",
    hint: "Powers Discover, Search, and posters. The one key worth adding first.",
    placeholder: "TMDB v3 API key",
  },
  {
    provider: "opensubtitles",
    label: "OpenSubtitles API key",
    hint: "Optional - in-player subtitle search and download.",
    placeholder: "OpenSubtitles key",
  },
  {
    provider: "openai",
    label: "AI provider key",
    hint: "Optional - OpenAI key enables the Assistant and mood curation.",
    placeholder: "OpenAI API key",
  },
];

// TorBox first: canonical service order (matches DebridServiceType.allCases);
// it is also the default provider (DEFAULT_DEBRID_PROVIDER = first entry).
export const DEBRID_PROVIDER_OPTIONS: DebridProviderOption[] = [
  {
    provider: "torbox",
    label: "TorBox",
    placeholder: "TorBox API token",
  },
  {
    provider: "real_debrid",
    label: "Real-Debrid",
    placeholder: "Real-Debrid API token",
  },
  {
    provider: "premiumize",
    label: "Premiumize",
    placeholder: "Premiumize API token",
  },
  {
    provider: "all_debrid",
    label: "AllDebrid",
    placeholder: "AllDebrid API token",
  },
];

export const DEFAULT_DEBRID_PROVIDER = DEBRID_PROVIDER_OPTIONS[0].provider;

export function debridProviderOption(
  provider: DebridCredentialProvider,
): DebridProviderOption {
  return (
    DEBRID_PROVIDER_OPTIONS.find((option) => option.provider === provider) ??
    DEBRID_PROVIDER_OPTIONS[0]
  );
}

export function buildServerSetupCredentialDrafts(input: {
  debridProvider: DebridCredentialProvider;
  debridToken: string;
  values: Partial<Record<ServerCredentialProvider, string>>;
}): ServerSetupCredentialDraft[] {
  const drafts: ServerSetupCredentialDraft[] = SERVER_SETUP_KEY_FIELDS.map((field) => ({
    provider: field.provider,
    label: field.label,
    value: (input.values[field.provider] ?? "").trim(),
  })).filter((entry) => entry.value.length > 0);

  const trimmedDebridToken = input.debridToken.trim();
  if (trimmedDebridToken.length > 0) {
    const selectedDebrid = debridProviderOption(input.debridProvider);
    drafts.push({
      provider: selectedDebrid.provider,
      label: selectedDebrid.label,
      value: trimmedDebridToken,
    });
  }

  return drafts;
}
