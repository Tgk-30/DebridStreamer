import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROVIDERS,
  formatProviderResult,
  runProviderSmoke,
  smokeProvider,
} from "./provider_smoke.mjs";

function response(json, status = 200, { retryAfter } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null;
      },
    },
    json: async () => json,
  };
}

function provider(id) {
  const found = PROVIDERS.find((entry) => entry.id === id);
  assert.ok(found, `missing provider fixture: ${id}`);
  return found;
}

test("Real-Debrid checks account plus the read-only torrent list and leaves cache unavailable", async () => {
  const calls = [];
  const result = await smokeProvider(provider("real_debrid"), "token", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith("/user") ? response({ username: "reader" }) : response([]);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.real-debrid.com/rest/1.0/user",
      "https://api.real-debrid.com/rest/1.0/torrents?limit=1",
    ],
  );
  assert.equal(calls.every((call) => call.init.method === "GET"), true);
  assert.equal(calls.some((call) => call.url.includes("token")), false);
  assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer token"), true);
  assert.equal(result.torrents.ok, true);
  assert.deepEqual(result.cache, {
    ok: null,
    durationMs: 0,
    reason: "unsupported",
  });
  assert.match(formatProviderResult(result), /cache unavailable \(reason unsupported\)/);
  assert.doesNotMatch(formatProviderResult(result), /cache passed/);
});

test("Real-Debrid torrent-list validation requires an array", async () => {
  const result = await smokeProvider(provider("real_debrid"), "token", {
    fetchImpl: async (url) =>
      url.endsWith("/user")
        ? response({ username: "reader" })
        : response({ torrents: [] }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.torrents.reason, "unexpected-shape");
  assert.equal(result.cache.ok, null);
});

test("TorBox requires success true and non-null object data for both checks", async () => {
  const valid = await smokeProvider(provider("torbox"), "token", {
    fetchImpl: async () => response({ success: true, data: {} }),
  });
  assert.equal(valid.ok, true);

  const failedAccount = await smokeProvider(provider("torbox"), "token", {
    fetchImpl: async () => response({ success: false, data: {} }),
  });
  assert.equal(failedAccount.account.reason, "unexpected-shape");

  let calls = 0;
  const failedCache = await smokeProvider(provider("torbox"), "token", {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response({ success: true, data: {} })
        : response({ success: true, data: null });
    },
  });
  assert.equal(failedCache.cache.reason, "unexpected-shape");
});

test("Premiumize requires success status and uses bearer authentication", async () => {
  const calls = [];
  const valid = await smokeProvider(provider("premiumize"), "token", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.includes("cache/check")
        ? response({ status: "success", response: [false] })
        : response({ status: "success", customer_id: "customer" });
    },
  });
  assert.equal(valid.ok, true);
  assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer token"), true);
  assert.equal(calls.every((call) => !("X-API-Key" in call.init.headers)), true);
  const cacheCall = calls.find((call) => call.url.includes("cache/check"));
  assert.equal(
    cacheCall.init.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.match(cacheCall.init.body, /^items%5B%5D=|^items\[\]=/);

  const missingStatus = await smokeProvider(provider("premiumize"), "token", {
    fetchImpl: async () => response({ customer_id: "customer" }),
  });
  assert.equal(missingStatus.account.reason, "unexpected-shape");

  let cacheCalls = 0;
  const failedCache = await smokeProvider(provider("premiumize"), "token", {
    fetchImpl: async () => {
      cacheCalls += 1;
      return cacheCalls === 1
        ? response({ status: "success", customer_id: "customer" })
        : response({ status: "error", response: [false] });
    },
  });
  assert.equal(failedCache.cache.reason, "unexpected-shape");

  let mismatchedCalls = 0;
  const mismatchedCache = await smokeProvider(provider("premiumize"), "token", {
    fetchImpl: async () => {
      mismatchedCalls += 1;
      return mismatchedCalls === 1
        ? response({ status: "success", customer_id: "customer" })
        : response({ status: "success", response: [] });
    },
  });
  assert.equal(mismatchedCache.cache.reason, "unexpected-shape");
});

test("AllDebrid requires success status and does not send X-API-Key", async () => {
  const calls = [];
  const valid = await smokeProvider(provider("all_debrid"), "token", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.includes("magnet/instant")
        ? response({ status: "success", data: { magnets: [] } })
        : response({ status: "success", data: { user: {} } });
    },
  });
  assert.equal(valid.ok, true);
  assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer token"), true);
  assert.equal(calls.every((call) => !("X-API-Key" in call.init.headers)), true);

  const missingStatus = await smokeProvider(provider("all_debrid"), "token", {
    fetchImpl: async () => response({ data: { user: {} } }),
  });
  assert.equal(missingStatus.account.reason, "unexpected-shape");

  let cacheCalls = 0;
  const failedCache = await smokeProvider(provider("all_debrid"), "token", {
    fetchImpl: async () => {
      cacheCalls += 1;
      return cacheCalls === 1
        ? response({ status: "success", data: { user: {} } })
        : response({ status: "error", data: { magnets: [] } });
    },
  });
  assert.equal(failedCache.cache.reason, "unexpected-shape");
});

test("provider validators are computed once per response", async () => {
  let validations = 0;
  const result = await smokeProvider(
    {
      id: "validator_once",
      label: "Validator once",
      account: {
        url: "https://example.invalid/account",
        valid: () => {
          validations += 1;
          return true;
        },
      },
      cache: null,
    },
    "token",
    { fetchImpl: async () => response({}) },
  );

  assert.equal(result.ok, true);
  assert.equal(validations, 1);
});

test("429 retries once, caps Retry-After at five seconds, and injects sleep", async () => {
  const calls = [];
  const sleeps = [];
  const result = await smokeProvider(
    {
      id: "retry_429",
      label: "Retry 429",
      account: { url: "https://example.invalid/account", valid: (json) => json.ok === true },
      cache: null,
    },
    "token",
    {
      fetchImpl: async (_url, init) => {
        calls.push(init);
        return calls.length === 1
          ? response({}, 429, { retryAfter: "30" })
          : response({ ok: true });
      },
      sleepImpl: async (ms) => sleeps.push(ms),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [5_000]);
  assert.notEqual(calls[0].signal, calls[1].signal);
});

test("5xx retries once while non-retryable HTTP failures do not", async () => {
  const retrySleeps = [];
  let retryCalls = 0;
  const retried = await smokeProvider(
    {
      id: "retry_503",
      label: "Retry 503",
      account: { url: "https://example.invalid/account", valid: () => true },
      cache: null,
    },
    "token",
    {
      fetchImpl: async () => {
        retryCalls += 1;
        return retryCalls === 1 ? response({}, 503) : response({});
      },
      sleepImpl: async (ms) => retrySleeps.push(ms),
    },
  );
  assert.equal(retried.ok, true);
  assert.equal(retryCalls, 2);
  assert.deepEqual(retrySleeps, [0]);

  let rejectedCalls = 0;
  const rejectedSleeps = [];
  const rejected = await smokeProvider(provider("real_debrid"), "token", {
    fetchImpl: async () => {
      rejectedCalls += 1;
      return response({ private: "body" }, 401);
    },
    sleepImpl: async (ms) => rejectedSleeps.push(ms),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejectedCalls, 1);
  assert.deepEqual(rejectedSleeps, []);
  assert.deepEqual(rejected.account, {
    ok: false,
    reason: "http-error",
    status: 401,
    durationMs: rejected.account.durationMs,
  });
  assert.equal(JSON.stringify(rejected).includes("private"), false);
});

test("every request attempt retains a hard timeout", async () => {
  let calls = 0;
  const result = await smokeProvider(
    {
      id: "timeout",
      label: "Timeout",
      account: { url: "https://example.invalid/account", valid: () => true },
      cache: null,
    },
    "token",
    {
      timeoutMs: 1,
      fetchImpl: async (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.account.ok, false);
  assert.equal(result.account.reason, "timeout");
});

test("result formatting includes pass durations and failure status, reason, and duration", () => {
  assert.equal(
    formatProviderResult({
      ok: false,
      label: "Example",
      account: { ok: true, durationMs: 12 },
      cache: {
        ok: false,
        status: 503,
        reason: "http-error",
        durationMs: 34,
      },
    }),
    "FAIL Example: account passed (12ms), cache failed (status 503, reason http-error, 34ms)",
  );
});

test("provider smoke reports response-shape failures without response bodies", async () => {
  const malformed = await smokeProvider(provider("real_debrid"), "token", {
    fetchImpl: async () => response({ privatePayload: "sensitive-body" }),
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.account.reason, "unexpected-shape");
  assert.equal(JSON.stringify(malformed).includes("sensitive-body"), false);
});

test("runner executes only configured providers and sends Premiumize cache form data", async () => {
  const calls = [];
  const report = await runProviderSmoke({
    env: { DS_SMOKE_PREMIUMIZE_TOKEN: "configured-token" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.includes("cache/check")
        ? response({ status: "success", response: [false] })
        : response({ status: "success", customer_id: "customer" });
    },
  });

  assert.equal(report.configured, 1);
  assert.deepEqual(report.results.map((result) => result.id), ["premiumize"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.body, `items[]=${"0".repeat(40)}`);
  assert.equal(calls[1].url.includes("items"), false);
  assert.equal(
    calls[1].init.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
});

test("malformed smoke hashes fail before any network request", async () => {
  let called = false;
  await assert.rejects(
    smokeProvider(PROVIDERS[0], "token", {
      hash: "bad",
      fetchImpl: async () => {
        called = true;
        return response({});
      },
    }),
    /40-character/,
  );
  assert.equal(called, false);
});
