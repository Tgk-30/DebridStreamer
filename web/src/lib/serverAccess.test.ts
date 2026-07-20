// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauri = vi.fn<() => boolean>();
vi.mock("./tauri", () => ({ isTauri: () => isTauri() }));

const nativeFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => nativeFetch(...args),
}));

const existingWindow = vi.fn();
const setFocus = vi.fn();
const once = vi.fn();
const WebviewWindow = vi.fn(function MockWebviewWindow() {
  return { once };
});
Object.assign(WebviewWindow, {
  getByLabel: (...args: unknown[]) => existingWindow(...args),
});
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow }));

function redirectResponse(location: string | null, status = 302): Response {
  return {
    status,
    headers: new Headers(location == null ? undefined : { location }),
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  isTauri.mockReturnValue(true);
  existingWindow.mockResolvedValue(null);
  once.mockImplementation((event: string, handler: () => void) => {
    if (event === "tauri://created") queueMicrotask(handler);
    return Promise.resolve(() => undefined);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("needsCloudflareAccessLogin", () => {
  it("detects the Cloudflare Access redirect without following it", async () => {
    nativeFetch.mockResolvedValue(
      redirectResponse(
        "https://team.cloudflareaccess.com/cdn-cgi/access/login/server.example",
      ),
    );
    const { needsCloudflareAccessLogin } = await import("./serverAccess");

    await expect(
      needsCloudflareAccessLogin("https://server.example"),
    ).resolves.toBe(true);
    expect(nativeFetch).toHaveBeenCalledWith(
      "https://server.example/api/bootstrap",
      { method: "GET", maxRedirections: 0 },
    );
  });

  it("does not misclassify ordinary redirects or successful responses", async () => {
    const { needsCloudflareAccessLogin } = await import("./serverAccess");
    nativeFetch.mockResolvedValueOnce(
      redirectResponse("https://server.example/login"),
    );
    await expect(
      needsCloudflareAccessLogin("https://server.example"),
    ).resolves.toBe(false);

    nativeFetch.mockResolvedValueOnce(redirectResponse(null, 200));
    await expect(
      needsCloudflareAccessLogin("https://server.example"),
    ).resolves.toBe(false);
  });

  it("stays inert outside Tauri and treats probe errors as inconclusive", async () => {
    const { needsCloudflareAccessLogin } = await import("./serverAccess");
    isTauri.mockReturnValue(false);
    await expect(
      needsCloudflareAccessLogin("https://server.example"),
    ).resolves.toBe(false);
    expect(nativeFetch).not.toHaveBeenCalled();

    isTauri.mockReturnValue(true);
    nativeFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(
      needsCloudflareAccessLogin("https://server.example"),
    ).resolves.toBe(false);
  });
});

describe("openServerAccessLogin", () => {
  it("focuses an existing sign-in window", async () => {
    existingWindow.mockResolvedValue({ setFocus });
    setFocus.mockResolvedValue(undefined);
    const { openServerAccessLogin } = await import("./serverAccess");

    await openServerAccessLogin("https://server.example");
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("creates a separate server sign-in webview", async () => {
    const { openServerAccessLogin } = await import("./serverAccess");
    await openServerAccessLogin("https://server.example");

    expect(WebviewWindow).toHaveBeenCalledWith(
      "server-access-login",
      expect.objectContaining({
        url: "https://server.example",
        title: "YAWF Stream server sign-in",
      }),
    );
  });
});
