import { describe, expect, it, vi } from "vitest";
import {
  IndexerType,
  IndexerError,
  ProviderSubtype,
  defaultFetchImpl,
  makeIndexerConfig,
} from "./types";

describe("IndexerType helpers", () => {
  it("maps user-facing names", () => {
    expect(IndexerType.displayName("jackett")).toBe("Jackett");
    expect(IndexerType.displayName("stremio_addon")).toBe("Stremio Addon");
    expect(IndexerType.displayName("built_in")).toBe("Built-in Scrapers");
  });

  it("defaults subtype and endpoint path per type", () => {
    expect(IndexerType.defaultProviderSubtype("jackett")).toBe(ProviderSubtype.jackett);
    expect(IndexerType.defaultEndpointPath("jackett")).toBe(
      "/api/v2.0/indexers/all/results/torznab/api",
    );
    expect(IndexerType.defaultEndpointPath("built_in")).toBe("");
    expect(IndexerType.defaultEndpointPath("zilean")).toBe("/api");
    expect(IndexerType.defaultProviderSubtype("prowlarr")).toBe(ProviderSubtype.prowlarr);
  });
});

describe("makeIndexerConfig defaults", () => {
  it("fills optional fields when omitted", () => {
    const cfg = makeIndexerConfig({
      id: "x",
      type: "jackett",
      baseURL: "https://j",
    });

    expect(cfg).toMatchObject({
      id: "x",
      type: "jackett",
      baseURL: "https://j",
      apiKey: null,
      isActive: true,
      displayName: null,
      providerSubtype: ProviderSubtype.jackett,
      endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
      categoryFilter: null,
      priority: 0,
    });
  });

  it("respects explicit optional values", () => {
    const cfg = makeIndexerConfig({
      id: "x",
      type: "prowlarr",
      baseURL: "https://p",
      apiKey: "k",
      isActive: false,
      displayName: "Self",
      providerSubtype: ProviderSubtype.customTorznab,
      endpointPath: "/custom",
      categoryFilter: "cat",
      priority: 9,
    });
    expect(cfg.providerSubtype).toBe(ProviderSubtype.customTorznab);
    expect(cfg.endpointPath).toBe("/custom");
    expect(cfg.priority).toBe(9);
  });
});

describe("IndexerError factories", () => {
  it("formats bad-server-response errors", () => {
    const err = IndexerError.badServerResponse(502);
    expect(err.kind).toBe("badServerResponse");
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain("HTTP 502");
  });

  it("formats bad URL and parse errors", () => {
    expect(IndexerError.badURL("https://bad").message).toBe("Bad URL: https://bad");
    expect(IndexerError.cannotParseResponse()).toMatchObject({
      kind: "cannotParseResponse",
      message: "Cannot parse response",
    });
  });
});

describe("defaultFetchImpl", () => {
  it("delegates to global fetch", async () => {
    const response = {
      status: 204,
      text: async () => "",
    };
    const fetchSpy = vi.fn(async () => response as never);
    vi.stubGlobal("fetch", fetchSpy);

    const responseOut = await defaultFetchImpl("https://example.test", {
      headers: { "x-test": "1" },
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://example.test", {
      headers: { "x-test": "1" },
    });
    expect(responseOut.status).toBe(204);
    expect(await responseOut.text()).toBe("");
    vi.unstubAllGlobals();
  });
});
