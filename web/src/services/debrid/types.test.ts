import { describe, expect, it, vi } from "vitest";
import {
  DebridError,
  defaultFetchImpl,
  formValueEncode,
  urlQueryEncode,
} from "./types";

describe("DebridError", () => {
  it("implements kinded equality for all variants", () => {
    const a = DebridError.invalidToken();
    const b = DebridError.expired();
    const c = DebridError.expired();

    expect(a.equals(b)).toBe(false);
    expect(c.equals(DebridError.expired())).toBe(true);

    const missingTorrentA = DebridError.torrentNotFound("abc");
    const missingTorrentB = DebridError.torrentNotFound("def");
    expect(missingTorrentA.equals(missingTorrentA)).toBe(true);
    expect(missingTorrentA.equals(missingTorrentB)).toBe(false);

    const dlFailA = DebridError.downloadFailed("oops");
    const dlFailB = DebridError.downloadFailed("oops");
    const dlFailC = DebridError.downloadFailed("nope");
    expect(dlFailA.equals(dlFailB)).toBe(true);
    expect(dlFailA.equals(dlFailC)).toBe(false);

    const netA = DebridError.networkError("timeout");
    const netB = DebridError.networkError("timeout");
    expect(netA.equals(netB)).toBe(true);
    expect(DebridError.httpError(500, "x").equals(DebridError.httpError(500, "x"))).toBe(
      true,
    );
    expect(DebridError.httpError(500, "x").equals(DebridError.httpError(400, "x"))).toBe(
      false,
    );
    expect(DebridError.noFilesAvailable().equals(DebridError.noFilesAvailable())).toBe(true);
  });

  it("supports kind checks for both matching and non-matching inputs", () => {
    const err = DebridError.rateLimited();
    expect(DebridError.is(err, "rateLimited")).toBe(true);
    expect(DebridError.is(err, "invalidToken")).toBe(false);
    expect(DebridError.is({} as unknown, "rateLimited")).toBe(false);
    expect(DebridError.is("oops" as unknown, "rateLimited")).toBe(false);
  });
});

describe("encoding helpers", () => {
  it("keeps Swift-style urlQuery allowed characters unescaped", () => {
    expect(urlQueryEncode("A B!$&'()*+,/:;=?@Z")).toBe("A%20B!$&'()*+,/:;=?@Z");
    expect(urlQueryEncode("a+b&c=d")).toBe("a+b&c=d");
    expect(urlQueryEncode("a#b")).toBe("a%23b");
  });

  it("encodes form values as application/x-www-form-urlencoded fields", () => {
    expect(formValueEncode("a+b&c=d")).toBe("a%2Bb%26c%3Dd");
    expect(formValueEncode(" hello ")).toBe("%20hello%20");
  });
});

describe("defaultFetchImpl", () => {
  it("delegates request arguments to global fetch", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 204,
      text: async () => "ok",
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const impl = defaultFetchImpl();
    const response = await impl("/probe", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "body",
    });

    expect(fetchSpy).toHaveBeenCalledWith("/probe", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "body",
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("ok");
    vi.unstubAllGlobals();
  });
});
