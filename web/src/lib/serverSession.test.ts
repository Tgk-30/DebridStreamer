import { afterEach, describe, expect, it, vi } from "vitest";

// serverSession holds module-level mutable state (csrf, notifiedUnauthorized,
// unauthorizedHandler). To isolate tests we reset the module registry and
// re-import a fresh copy in each test via this helper.
type Mod = typeof import("./serverSession");
async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("./serverSession");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("serverSession", () => {
  describe("setCsrfToken / readCsrfToken (in-memory)", () => {
    it("stores a non-empty token and reads it back", async () => {
      const m = await freshModule();
      m.setCsrfToken("abc123");
      expect(m.readCsrfToken()).toBe("abc123");
    });

    it("ignores an empty string so it never clears a good token", async () => {
      const m = await freshModule();
      m.setCsrfToken("good");
      m.setCsrfToken("");
      expect(m.readCsrfToken()).toBe("good");
    });

    it("ignores null/undefined so it never clears a good token", async () => {
      const m = await freshModule();
      m.setCsrfToken("good");
      m.setCsrfToken(null);
      m.setCsrfToken(undefined);
      expect(m.readCsrfToken()).toBe("good");
    });

    it("ignores a non-string value (guards typeof)", async () => {
      const m = await freshModule();
      m.setCsrfToken("good");
      // @ts-expect-error deliberately passing a wrong type to exercise the guard
      m.setCsrfToken(123);
      expect(m.readCsrfToken()).toBe("good");
    });

    it("overwrites a previously stored token with a newer non-empty one", async () => {
      const m = await freshModule();
      m.setCsrfToken("old");
      m.setCsrfToken("new");
      expect(m.readCsrfToken()).toBe("new");
    });
  });

  describe("readCsrfToken (cookie fallback)", () => {
    it("returns null when no in-memory token and document is undefined", async () => {
      // node environment: document is not defined by default. Guard against any
      // global leakage by explicitly stubbing it undefined.
      vi.stubGlobal("document", undefined);
      const m = await freshModule();
      expect(m.readCsrfToken()).toBeNull();
    });

    it("reads the ds_csrf cookie when no in-memory token is set", async () => {
      vi.stubGlobal("document", { cookie: "foo=1; ds_csrf=tok-from-cookie; bar=2" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBe("tok-from-cookie");
    });

    it("trims surrounding whitespace around cookie parts", async () => {
      vi.stubGlobal("document", { cookie: "  ds_csrf=spaced  " });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBe("spaced");
    });

    it("URL-decodes the cookie value", async () => {
      vi.stubGlobal("document", { cookie: "ds_csrf=a%2Bb%3Dc" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBe("a+b=c");
    });

    it("returns null when the cookie is absent", async () => {
      vi.stubGlobal("document", { cookie: "session=xyz; other=1" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBeNull();
    });

    it("returns null for an empty cookie string", async () => {
      vi.stubGlobal("document", { cookie: "" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBeNull();
    });

    it("returns an empty string when the cookie has an empty value", async () => {
      vi.stubGlobal("document", { cookie: "ds_csrf=" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBe("");
    });

    it("prefers the in-memory token over the cookie", async () => {
      vi.stubGlobal("document", { cookie: "ds_csrf=cookie-value" });
      const m = await freshModule();
      m.setCsrfToken("memory-value");
      expect(m.readCsrfToken()).toBe("memory-value");
    });

    it("does not match a cookie name that merely contains ds_csrf as a substring", async () => {
      // startsWith("ds_csrf=") should not match "x_ds_csrf=..."
      vi.stubGlobal("document", { cookie: "x_ds_csrf=nope" });
      const m = await freshModule();
      expect(m.readCsrfToken()).toBeNull();
    });
  });

  describe("clearServerSession", () => {
    it("drops the in-memory token", async () => {
      vi.stubGlobal("document", undefined);
      const m = await freshModule();
      m.setCsrfToken("abc");
      expect(m.readCsrfToken()).toBe("abc");
      m.clearServerSession();
      expect(m.readCsrfToken()).toBeNull();
    });

    it("falls back to the cookie after clearing the in-memory token", async () => {
      vi.stubGlobal("document", { cookie: "ds_csrf=cookie-value" });
      const m = await freshModule();
      m.setCsrfToken("memory");
      expect(m.readCsrfToken()).toBe("memory");
      m.clearServerSession();
      expect(m.readCsrfToken()).toBe("cookie-value");
    });

    it("re-arms the unauthorized signal so the handler can fire again", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      m.onUnauthorized(handler);
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
      // Without re-arming, a second notify is debounced.
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
      // clearServerSession re-arms.
      m.clearServerSession();
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("onUnauthorized / notifyUnauthorized", () => {
    it("invokes the registered handler on the first notify", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      m.onUnauthorized(handler);
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("debounces a burst of notifies into a single handler call", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      m.onUnauthorized(handler);
      m.notifyUnauthorized();
      m.notifyUnauthorized();
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not throw when notifying with no handler registered", async () => {
      const m = await freshModule();
      expect(() => m.notifyUnauthorized()).not.toThrow();
    });

    it("unsubscribe removes the handler so later notifies do nothing", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      const unsub = m.onUnauthorized(handler);
      unsub();
      m.notifyUnauthorized();
      expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe only clears the handler if it is still the registered one", async () => {
      const m = await freshModule();
      const first = vi.fn();
      const second = vi.fn();
      const unsubFirst = m.onUnauthorized(first);
      // Registering a second handler replaces the first.
      m.onUnauthorized(second);
      // Calling the stale unsubscribe must NOT remove the current (second) handler.
      unsubFirst();
      m.notifyUnauthorized();
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });

    it("re-arms via a successful re-auth (setCsrfToken with a real token)", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      m.onUnauthorized(handler);
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
      // A successful re-auth provides a fresh token, re-arming the 401 signal.
      m.setCsrfToken("fresh-token");
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("an empty-token setCsrfToken does NOT re-arm the unauthorized signal", async () => {
      const m = await freshModule();
      const handler = vi.fn();
      m.onUnauthorized(handler);
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
      // Empty token is ignored, so the signal stays disarmed.
      m.setCsrfToken("");
      m.notifyUnauthorized();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
