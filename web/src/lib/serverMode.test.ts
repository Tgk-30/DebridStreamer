import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredServerURL,
  configuredServerURLSource,
  isServerMode,
  saveServerURL,
} from "./serverMode";

const SERVER_URL_STORAGE_KEY = "debridstreamer.server.url";
const g = globalThis as Record<string, unknown>;

// NOTE on the env source:
// serverMode.ts reads the highest-precedence env value via an indirected access
// (`const env = (import.meta as ...).env; return env?.[key]`). vitest's static
// `import.meta.env.KEY` replacement only fires on *direct literal* property
// access, so this dynamic form is neither statically replaced nor reachable via
// `vi.stubEnv`. There is also no `.env` file defining VITE_DEBRIDSTREAMER_SERVER_URL,
// so `envValue` always returns "" in this suite. We therefore exercise every
// branch that does NOT require a non-empty env value (i.e. env is treated as
// unset and we fall through to the injected global and localStorage), and leave
// the populated-env precedence cases as documented `it.skip`s rather than write
// flaky/failing tests. With env always empty, "fall-through" behavior is exactly
// what these tests assert.

// A simple in-memory localStorage stand-in so we exercise the real string logic
// without depending on a browser/jsdom environment.
function makeLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    store: data,
    getItem: vi.fn((k: string) => (data.has(k) ? data.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
  };
}

describe("serverMode", () => {
  beforeEach(() => {
    delete g.__DEBRIDSTREAMER_SERVER_URL__;
    delete g.localStorage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete g.__DEBRIDSTREAMER_SERVER_URL__;
    delete g.localStorage;
  });

  describe("configuredServerURL", () => {
    it("returns null when nothing is configured (no env, no injected, no localStorage)", () => {
      expect(configuredServerURL()).toBeNull();
    });

    it("returns null when localStorage exists but is empty", () => {
      g.localStorage = makeLocalStorage();
      expect(configuredServerURL()).toBeNull();
    });

    // Populated-env cases are unreachable in this harness (see top-of-file note).
    it.skip("uses VITE_DEBRIDSTREAMER_SERVER_URL when set (env not stubbable here)", () => {});
    it.skip("env takes precedence over injected and localStorage (env not stubbable here)", () => {});

    describe("injected (same-origin) source", () => {
      it("uses the injected global when set", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com";
        expect(configuredServerURL()).toBe("https://injected.example.com");
      });

      it("trims and strips trailing slashes from the injected value", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "  https://injected.example.com/  ";
        expect(configuredServerURL()).toBe("https://injected.example.com");
      });

      it("strips multiple trailing slashes", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com////";
        expect(configuredServerURL()).toBe("https://injected.example.com");
      });

      it("treats null injected value as unset", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = null;
        expect(configuredServerURL()).toBeNull();
      });

      it("treats undefined injected value as unset", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = undefined;
        expect(configuredServerURL()).toBeNull();
      });

      it("treats empty-string injected value as unset", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "";
        expect(configuredServerURL()).toBeNull();
      });

      it("treats a bare slash injected value as empty server URL (not local)", () => {
        // normalizeBaseURL("/") => "", but the injected check is on the raw
        // trimmed length (1), so it IS treated as configured and returns "".
        g.__DEBRIDSTREAMER_SERVER_URL__ = "/";
        expect(configuredServerURL()).toBe("");
      });

      it("treats whitespace-only injected value as unset and falls through to localStorage", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "   ";
        g.localStorage = makeLocalStorage({
          [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
        });
        expect(configuredServerURL()).toBe("https://saved.example.com");
      });

      it("takes precedence over localStorage", () => {
        g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com";
        g.localStorage = makeLocalStorage({
          [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
        });
        expect(configuredServerURL()).toBe("https://injected.example.com");
      });
    });

    describe("saved (localStorage) source", () => {
      it("uses the stored value when present", () => {
        g.localStorage = makeLocalStorage({
          [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
        });
        expect(configuredServerURL()).toBe("https://saved.example.com");
      });

      it("trims and strips trailing slashes from the stored value", () => {
        g.localStorage = makeLocalStorage({
          [SERVER_URL_STORAGE_KEY]: "  https://saved.example.com//  ",
        });
        expect(configuredServerURL()).toBe("https://saved.example.com");
      });

      it("treats a whitespace-only stored value as unset", () => {
        g.localStorage = makeLocalStorage({
          [SERVER_URL_STORAGE_KEY]: "   ",
        });
        expect(configuredServerURL()).toBeNull();
      });

      it("treats an empty stored value as unset", () => {
        g.localStorage = makeLocalStorage({ [SERVER_URL_STORAGE_KEY]: "" });
        expect(configuredServerURL()).toBeNull();
      });

      it("normalizes a bare-slash stored value to empty string", () => {
        g.localStorage = makeLocalStorage({ [SERVER_URL_STORAGE_KEY]: "/" });
        // The stored-value guard requires trim().length > 0 ("/" passes), then
        // normalizeBaseURL("/") => "".
        expect(configuredServerURL()).toBe("");
      });

      it("swallows localStorage.getItem errors and returns null", () => {
        const throwing = makeLocalStorage();
        throwing.getItem = vi.fn(() => {
          throw new Error("private mode");
        });
        g.localStorage = throwing;
        expect(configuredServerURL()).toBeNull();
      });
    });
  });

  describe("configuredServerURLSource", () => {
    it("returns null when nothing is configured", () => {
      expect(configuredServerURLSource()).toBeNull();
    });

    // env populated-source cases unreachable here (see top-of-file note).
    it.skip("returns 'env' when env var is set (env not stubbable here)", () => {});

    it("returns 'same-origin' when injected global is set", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com";
      expect(configuredServerURLSource()).toBe("same-origin");
    });

    it("treats whitespace-only injected as no same-origin source", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "   ";
      expect(configuredServerURLSource()).toBeNull();
    });

    it("returns 'saved' when only localStorage has a value", () => {
      g.localStorage = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
      });
      expect(configuredServerURLSource()).toBe("saved");
    });

    it("treats whitespace-only stored value as no source", () => {
      g.localStorage = makeLocalStorage({ [SERVER_URL_STORAGE_KEY]: "  " });
      expect(configuredServerURLSource()).toBeNull();
    });

    it("respects same-origin > saved precedence", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com";
      g.localStorage = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
      });
      expect(configuredServerURLSource()).toBe("same-origin");
    });

    it("swallows localStorage errors and returns null", () => {
      const throwing = makeLocalStorage();
      throwing.getItem = vi.fn(() => {
        throw new Error("private mode");
      });
      g.localStorage = throwing;
      expect(configuredServerURLSource()).toBeNull();
    });
  });

  describe("isServerMode", () => {
    it("is false when nothing is configured", () => {
      expect(isServerMode()).toBe(false);
    });

    it("is true when an injected URL is configured", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "https://injected.example.com";
      expect(isServerMode()).toBe(true);
    });

    it("is true when a saved URL is configured", () => {
      g.localStorage = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://saved.example.com",
      });
      expect(isServerMode()).toBe(true);
    });

    it("is still true when the configured value normalizes to empty (bare slash)", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "/";
      // configuredServerURL returns "" (not null), so server mode is still active.
      expect(configuredServerURL()).toBe("");
      expect(isServerMode()).toBe(true);
    });

    it("is false when injected value is whitespace-only", () => {
      g.__DEBRIDSTREAMER_SERVER_URL__ = "   ";
      expect(isServerMode()).toBe(false);
    });
  });

  describe("saveServerURL", () => {
    it("stores a normalized URL", () => {
      const ls = makeLocalStorage();
      g.localStorage = ls;
      saveServerURL("https://save.example.com///");
      expect(ls.setItem).toHaveBeenCalledWith(
        SERVER_URL_STORAGE_KEY,
        "https://save.example.com",
      );
      expect(ls.store.get(SERVER_URL_STORAGE_KEY)).toBe("https://save.example.com");
    });

    it("normalizes surrounding whitespace before storing", () => {
      const ls = makeLocalStorage();
      g.localStorage = ls;
      saveServerURL("  https://save.example.com/  ");
      expect(ls.store.get(SERVER_URL_STORAGE_KEY)).toBe("https://save.example.com");
    });

    it("removes the key when given null", () => {
      const ls = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://old.example.com",
      });
      g.localStorage = ls;
      saveServerURL(null);
      expect(ls.removeItem).toHaveBeenCalledWith(SERVER_URL_STORAGE_KEY);
      expect(ls.store.has(SERVER_URL_STORAGE_KEY)).toBe(false);
    });

    it("removes the key when given an empty string", () => {
      const ls = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://old.example.com",
      });
      g.localStorage = ls;
      saveServerURL("");
      expect(ls.removeItem).toHaveBeenCalledWith(SERVER_URL_STORAGE_KEY);
      expect(ls.setItem).not.toHaveBeenCalled();
    });

    it("removes the key when given a whitespace-only string", () => {
      const ls = makeLocalStorage({
        [SERVER_URL_STORAGE_KEY]: "https://old.example.com",
      });
      g.localStorage = ls;
      saveServerURL("   ");
      expect(ls.removeItem).toHaveBeenCalledWith(SERVER_URL_STORAGE_KEY);
      expect(ls.setItem).not.toHaveBeenCalled();
    });

    it("saved URL round-trips back through configuredServerURL / Source", () => {
      g.localStorage = makeLocalStorage();
      saveServerURL("https://roundtrip.example.com/");
      expect(configuredServerURL()).toBe("https://roundtrip.example.com");
      expect(configuredServerURLSource()).toBe("saved");
      expect(isServerMode()).toBe(true);
    });

    it("swallows setItem errors (private mode) without throwing", () => {
      const throwing = makeLocalStorage();
      throwing.setItem = vi.fn(() => {
        throw new Error("quota exceeded");
      });
      g.localStorage = throwing;
      expect(() => saveServerURL("https://save.example.com")).not.toThrow();
    });

    it("swallows removeItem errors without throwing", () => {
      const throwing = makeLocalStorage();
      throwing.removeItem = vi.fn(() => {
        throw new Error("private mode");
      });
      g.localStorage = throwing;
      expect(() => saveServerURL(null)).not.toThrow();
    });

    it("does not throw when localStorage is entirely unavailable", () => {
      // No g.localStorage set; optional chaining should make this a no-op.
      expect(() => saveServerURL("https://save.example.com")).not.toThrow();
      expect(() => saveServerURL(null)).not.toThrow();
    });
  });
});
