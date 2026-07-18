import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDERS, runProviderSmoke, smokeProvider } from "./provider_smoke.mjs";

function response(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  };
}

test("provider smoke checks account and cache without putting tokens in URLs", async () => {
  const token = "super-secret-provider-token";
  const calls = [];
  const provider = PROVIDERS.find((entry) => entry.id === "torbox");
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return url.includes("checkcached")
      ? response({ data: {} })
      : response({ data: { plan: 1 } });
  };

  const result = await smokeProvider(provider, token, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => call.url.includes(token)), false);
  assert.equal(calls.every((call) => call.init.headers.Authorization.includes(token)), true);
});

test("provider smoke reports HTTP and response-shape failures without response bodies", async () => {
  const provider = PROVIDERS.find((entry) => entry.id === "real_debrid");
  const failed = await smokeProvider(provider, "token", {
    fetchImpl: async () => response({ private: "body" }, 401),
  });
  assert.deepEqual(failed.account, {
    ok: false,
    durationMs: failed.account.durationMs,
    status: 401,
  });
  assert.equal(JSON.stringify(failed).includes("private"), false);

  const malformed = await smokeProvider(provider, "token", {
    fetchImpl: async () => response({ unexpected: true }),
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.account.reason, "unexpected-shape");
});

test("runner executes only configured providers", async () => {
  const calls = [];
  const report = await runProviderSmoke({
    env: { DS_SMOKE_PREMIUMIZE_TOKEN: "configured-token" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url.includes("cache/check")
        ? response({ response: [false] })
        : response({ customer_id: "customer" });
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
  const provider = PROVIDERS[0];
  let called = false;
  await assert.rejects(
    smokeProvider(provider, "token", {
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
