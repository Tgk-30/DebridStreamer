import { describe, expect, it } from "vitest";
import { CONCEPTS, SIGNUP_LINKS, signupUrl } from "./onboardingHelp";

describe("onboardingHelp", () => {
  it("defines a term + non-empty blurb for every concept", () => {
    for (const key of Object.keys(CONCEPTS) as (keyof typeof CONCEPTS)[]) {
      expect(CONCEPTS[key].term.length).toBeGreaterThan(0);
      expect(CONCEPTS[key].blurb.length).toBeGreaterThan(20);
    }
  });

  it("has an https signup link for each provider, with unique ids", () => {
    const ids = new Set<string>();
    for (const link of SIGNUP_LINKS) {
      expect(link.url.startsWith("https://")).toBe(true);
      expect(ids.has(link.id)).toBe(false);
      ids.add(link.id);
    }
    // The two essentials for a first stream are present.
    expect(ids.has("tmdb")).toBe(true);
    expect(ids.has("realDebrid")).toBe(true);
  });

  it("resolves signupUrl by id and returns null for unknown ids", () => {
    expect(signupUrl("tmdb")).toBe("https://www.themoviedb.org/settings/api");
    expect(signupUrl("nope")).toBeNull();
  });
});
