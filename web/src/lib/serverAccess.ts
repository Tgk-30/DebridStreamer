import { isTauri } from "./tauri";

const ACCESS_WINDOW_LABEL = "server-access-login";

/** Cloudflare Access redirects API requests through this path before the
 * protected origin is allowed to answer. Browsers hide that cross-origin
 * redirect behind a generic fetch error, so the desktop shell probes it with
 * the native HTTP client after a bootstrap failure. */
function isCloudflareAccessRedirect(location: string, baseURL: string): boolean {
  try {
    const url = new URL(location, baseURL);
    return (
      url.pathname.startsWith("/cdn-cgi/access/") ||
      url.hostname.toLowerCase().endsWith(".cloudflareaccess.com")
    );
  } catch {
    return false;
  }
}

/** Return true when an otherwise reachable server is protected by a
 * Cloudflare Access session that this desktop webview does not have yet. */
export async function needsCloudflareAccessLogin(baseURL: string): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
    const response = await nativeFetch(`${baseURL}/api/bootstrap`, {
      method: "GET",
      maxRedirections: 0,
    });
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    return (
      response.status >= 300 &&
      response.status < 400 &&
      location != null &&
      isCloudflareAccessRedirect(location, baseURL)
    );
  } catch {
    // This is only a diagnostic fallback. Preserve the original bootstrap error
    // when the native probe is unavailable or the host is genuinely offline.
    return false;
  }
}

/** Open the configured server in a separate, unprivileged webview so the user
 * can complete Cloudflare Access authentication. Tauri webviews share their
 * platform cookie store, so the main window can retry the API after sign-in.
 * The login window is deliberately outside the `main` capability scope and
 * therefore has no access to app IPC commands. */
export async function openServerAccessLogin(baseURL: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Cloudflare Access sign-in is only available in the desktop app.");
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(ACCESS_WINDOW_LABEL);
  if (existing != null) {
    await existing.setFocus();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const loginWindow = new WebviewWindow(ACCESS_WINDOW_LABEL, {
      url: baseURL,
      title: "YAWF Stream server sign-in",
      width: 980,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      center: true,
      resizable: true,
    });
    void loginWindow.once("tauri://created", () => resolve());
    void loginWindow.once<string>("tauri://error", (event) => {
      reject(new Error(event.payload || "Could not open the server sign-in window."));
    });
  });
}
