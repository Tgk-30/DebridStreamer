// In-memory glue for the server-mode client session, shared by serverApi,
// RemoteStore, and ServerModeGate.
//
// Two responsibilities:
//  1. CSRF token. The server's double-submit check compares the `ds_csrf` cookie
//     to an `x-csrf-token` header. Same-origin clients can read the cookie via
//     document.cookie, but a CROSS-ORIGIN client (a pasted remote server URL)
//     cannot - document.cookie only exposes the page origin. So we capture the
//     token the server returns in its auth/bootstrap response bodies and hold it
//     here, falling back to the cookie only when in memory has nothing.
//  2. Unauthorized (401) signal. If the session expires/gets revoked while the
//     app is mounted, requests start 401ing. notifyUnauthorized() lets the gate
//     send the user back to the login screen instead of a half-broken shell.

let csrf: string | null = null;

/** Store a CSRF token captured from an auth/bootstrap response body. Ignores
 *  empty/missing values so a token-less response never clears a good token. */
export function setCsrfToken(token: string | null | undefined): void {
  if (typeof token === "string" && token.length > 0) {
    csrf = token;
    // A fresh token means we're authenticated again - re-arm the 401 signal.
    notifiedUnauthorized = false;
  }
}

/** The CSRF token to send on mutating requests: the in-memory value, else the
 *  `ds_csrf` cookie (readable only same-origin). */
export function readCsrfToken(): string | null {
  if (csrf != null) return csrf;
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ds_csrf="));
  return match != null ? decodeURIComponent(match.slice("ds_csrf=".length)) : null;
}

/** Drop the in-memory token (e.g. on logout/disconnect). */
export function clearServerSession(): void {
  csrf = null;
  notifiedUnauthorized = false;
}

let unauthorizedHandler: (() => void) | null = null;
let notifiedUnauthorized = false;

/** Register the handler that returns the app to the login gate on a 401. Returns
 *  an unsubscribe function. */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

/** Signal that a request was rejected with 401. Debounced so a burst of parallel
 *  failing requests triggers the handler once; re-armed by the next setCsrfToken
 *  (i.e. a successful re-auth). */
export function notifyUnauthorized(): void {
  if (notifiedUnauthorized) return;
  notifiedUnauthorized = true;
  unauthorizedHandler?.();
}
