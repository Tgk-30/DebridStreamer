import { describe, expect, it } from "vitest";
import {
  DEBRID_PROVIDER_OPTIONS,
  DEFAULT_DEBRID_PROVIDER,
  SERVER_SETUP_KEY_FIELDS,
  buildServerSetupCredentialDrafts,
  debridProviderOption,
} from "./serverSetupCredentials";

describe("serverSetupCredentials", () => {
  it("defaults the debrid selector to the first concrete provider", () => {
    expect(DEFAULT_DEBRID_PROVIDER).toBe(DEBRID_PROVIDER_OPTIONS[0].provider);
    expect(DEFAULT_DEBRID_PROVIDER).toBe("torbox");
  });

  it("offers every supported debrid credential provider", () => {
    expect(DEBRID_PROVIDER_OPTIONS.map((option) => option.provider)).toEqual([
      "torbox",
      "real_debrid",
      "premiumize",
      "all_debrid",
    ]);
  });

  it("keeps debrid tokens out of the generic key fields", () => {
    expect(SERVER_SETUP_KEY_FIELDS.map((field) => field.provider)).toEqual([
      "tmdb",
      "opensubtitles",
      "openai",
    ]);
  });

  it("returns provider-specific labels and placeholders", () => {
    expect(debridProviderOption("torbox")).toMatchObject({
      label: "TorBox",
      placeholder: "TorBox API token",
    });
  });

  it("builds trimmed credential drafts and skips empty fields", () => {
    expect(
      buildServerSetupCredentialDrafts({
        debridProvider: "real_debrid",
        debridToken: "  ",
        values: {
          tmdb: "  tmdb-key  ",
          opensubtitles: "",
          openai: "  openai-key\n",
        },
      }),
    ).toEqual([
      {
        provider: "tmdb",
        label: "TMDB API key",
        value: "tmdb-key",
      },
      {
        provider: "openai",
        label: "AI provider key",
        value: "openai-key",
      },
    ]);
  });

  it("saves the debrid token under the selected provider slot", () => {
    expect(
      buildServerSetupCredentialDrafts({
        debridProvider: "torbox",
        debridToken: "  torbox-token  ",
        values: {},
      }),
    ).toEqual([
      {
        provider: "torbox",
        label: "TorBox",
        value: "torbox-token",
      },
    ]);
  });

  it("keeps generic keys before the selected debrid credential", () => {
    expect(
      buildServerSetupCredentialDrafts({
        debridProvider: "premiumize",
        debridToken: "pm-token",
        values: { tmdb: "tmdb-key" },
      }).map((draft) => draft.provider),
    ).toEqual(["tmdb", "premiumize"]);
  });
});
