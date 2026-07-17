// Global test setup: fail loudly on any un-mocked outbound network fetch.
//
// The server reuses the browser indexer/debrid/metadata clients verbatim, and the
// built-in indexer set (Torrentio, APIBay, YTS, EZTV) fires real HTTP requests
// through `globalThis.fetch`. Tests stub `globalThis.fetch` per-test to return
// fixtures for the hosts they assert on — but a test only mocks the hosts it
// cares about, so the remaining built-in indexers (e.g. torrentio.strem.fun,
// eztv.wf) fall through to the *real* network. That made two stream tests flaky:
//
//   * a slow real indexer outlives `IndexerManager`'s 12s per-indexer timeout,
//     which itself outlives vitest's 5s test timeout → the request hangs and the
//     test times out (the "kids maturity" lockdown case);
//   * a real indexer answers and its live torrent outranks the fixture the test
//     asserts on → a wrong-result mismatch (the "profile proxy session" case),
//     including via a slow request abandoned by the timeout that settles later.
//
// This guard replaces `globalThis.fetch` with a version that allows loopback
// (the in-test HTTP servers listen on 127.0.0.1) but throws for any other host.
// Per-test mocks still shadow this — they assign their own `globalThis.fetch`
// and only reach here through their `originalFetch` fall-through — so a mocked
// host is answered before it ever gets here, and any *un-mocked* host now fails
// deterministically instead of leaking to the network. Indexer fetch errors are
// swallowed per-indexer by `searchAll`, so a blocked built-in indexer simply
// contributes nothing, exactly as a network-less environment should behave.

const realFetch: typeof fetch = globalThis.fetch;

/** Loopback hosts are the in-process test servers (127.0.0.1) and local upstreams
 *  (e.g. the Ollama endpoint). Everything else is an external dependency that a
 *  test must mock. */
function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase(); // strip [] from IPv6 literals
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h === "::" ||
    /^127\./.test(h)
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable target — never a legitimate in-test request; block it.
  }
  if (host && isLoopbackHost(host)) {
    return realFetch(input, init);
  }
  return Promise.reject(
    new Error(
      `[test] Blocked un-mocked outbound fetch to ${host || url}. ` +
        `Mock this host on globalThis.fetch in the test, or the request would ` +
        `leak to the real network (flaky). URL: ${url}`,
    ),
  );
}) as typeof fetch;
