#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_HASH = "0000000000000000000000000000000000000000";
const DEFAULT_TIMEOUT_MS = 15_000;

export const PROVIDERS = [
  {
    id: "real_debrid",
    label: "Real-Debrid",
    env: "DS_SMOKE_REAL_DEBRID_TOKEN",
    account: {
      url: "https://api.real-debrid.com/rest/1.0/user",
      valid: (json) => typeof json?.username === "string",
    },
    cache: null,
  },
  {
    id: "all_debrid",
    label: "AllDebrid",
    env: "DS_SMOKE_ALLDEBRID_TOKEN",
    account: {
      url: "https://api.alldebrid.com/v4/user?agent=YAWFStream",
      valid: (json) => typeof json?.data?.user === "object" && json.data.user !== null,
    },
    cache: {
      url: (hash) =>
        `https://api.alldebrid.com/v4/magnet/instant?agent=YAWFStream&magnets[]=${hash}`,
      valid: (json) => Array.isArray(json?.data?.magnets),
    },
  },
  {
    id: "premiumize",
    label: "Premiumize",
    env: "DS_SMOKE_PREMIUMIZE_TOKEN",
    account: {
      url: "https://www.premiumize.me/api/account/info",
      valid: (json) =>
        typeof json?.customer_id === "string" || typeof json?.status === "string",
    },
    cache: {
      url: "https://www.premiumize.me/api/cache/check",
      method: "POST",
      body: (hash) => `items[]=${encodeURIComponent(hash)}`,
      valid: (json) => Array.isArray(json?.response),
    },
  },
  {
    id: "torbox",
    label: "TorBox",
    env: "DS_SMOKE_TORBOX_TOKEN",
    account: {
      url: "https://api.torbox.app/v1/api/user/me",
      valid: (json) => typeof json?.data === "object" && json.data !== null,
    },
    cache: {
      url: (hash) =>
        `https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash}&format=object`,
      valid: (json) => typeof json?.data === "object" && json.data !== null,
    },
  },
];

function authHeaders(provider, token) {
  return {
    Authorization: `Bearer ${token}`,
    ...(provider.id === "all_debrid" || provider.id === "premiumize"
      ? { "X-API-Key": token }
      : {}),
  };
}

async function checkEndpoint(
  { url, valid, method = "GET", body },
  headers,
  fetchImpl,
  timeoutMs,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        ...headers,
        ...(body != null ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body != null ? { body } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, durationMs: Date.now() - startedAt, status: response.status };
    }
    let json;
    try {
      json = await response.json();
    } catch {
      return { ok: false, durationMs: Date.now() - startedAt, reason: "invalid-json" };
    }
    return {
      ok: Boolean(valid(json)),
      durationMs: Date.now() - startedAt,
      ...(!valid(json) ? { reason: "unexpected-shape" } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason: error?.name === "AbortError" ? "timeout" : "network-error",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function smokeProvider(
  provider,
  token,
  {
    hash = DEFAULT_HASH,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  if (!/^[a-f0-9]{40}$/i.test(hash)) {
    throw new Error("DS_SMOKE_INFO_HASH must be a 40-character hexadecimal info hash");
  }
  const headers = authHeaders(provider, token);
  const account = await checkEndpoint(
    provider.account,
    headers,
    fetchImpl,
    timeoutMs,
  );
  const cache =
    account.ok && provider.cache != null
      ? await checkEndpoint(
          {
            ...provider.cache,
            url:
              typeof provider.cache.url === "function"
                ? provider.cache.url(hash.toLowerCase())
                : provider.cache.url,
            body:
              typeof provider.cache.body === "function"
                ? provider.cache.body(hash.toLowerCase())
                : provider.cache.body,
          },
          headers,
          fetchImpl,
          timeoutMs,
        )
      : provider.cache == null
        ? { ok: true, durationMs: 0, reason: "not-applicable" }
        : { ok: false, durationMs: 0, reason: "account-failed" };
  return {
    id: provider.id,
    label: provider.label,
    ok: account.ok && cache.ok,
    account,
    cache,
  };
}

export async function runProviderSmoke({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const hash = env.DS_SMOKE_INFO_HASH?.trim() || DEFAULT_HASH;
  const configured = PROVIDERS.flatMap((provider) => {
    const token = env[provider.env]?.trim();
    return token ? [{ provider, token }] : [];
  });
  const results = [];
  for (const { provider, token } of configured) {
    results.push(await smokeProvider(provider, token, { hash, fetchImpl, timeoutMs }));
  }
  return { configured: configured.length, results };
}

async function main() {
  const report = await runProviderSmoke();
  if (report.configured === 0) {
    console.error("No provider smoke credentials are configured.");
    process.exitCode = 2;
    return;
  }
  for (const result of report.results) {
    const account = result.account.ok ? "account passed" : "account failed";
    const cache = result.cache.ok ? "cache passed" : "cache failed";
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${account}, ${cache}`);
  }
  if (report.results.some((result) => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
