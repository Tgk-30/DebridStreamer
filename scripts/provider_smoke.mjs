#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_HASH = "0000000000000000000000000000000000000000";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const PROVIDERS = [
  {
    id: "real_debrid",
    label: "Real-Debrid",
    env: "DS_SMOKE_REAL_DEBRID_TOKEN",
    account: {
      url: "https://api.real-debrid.com/rest/1.0/user",
      valid: (json) => typeof json?.username === "string",
    },
    torrents: {
      url: "https://api.real-debrid.com/rest/1.0/torrents?limit=1",
      valid: (json) => Array.isArray(json),
    },
    cache: null,
  },
  {
    id: "all_debrid",
    label: "AllDebrid",
    env: "DS_SMOKE_ALLDEBRID_TOKEN",
    account: {
      url: "https://api.alldebrid.com/v4/user?agent=YAWFStream",
      valid: (json) =>
        json?.status === "success" &&
        typeof json?.data?.user === "object" &&
        json.data.user !== null,
    },
    cache: {
      url: (hash) =>
        `https://api.alldebrid.com/v4/magnet/instant?agent=YAWFStream&magnets[]=${hash}`,
      valid: (json) =>
        json?.status === "success" && Array.isArray(json?.data?.magnets),
    },
  },
  {
    id: "premiumize",
    label: "Premiumize",
    env: "DS_SMOKE_PREMIUMIZE_TOKEN",
    account: {
      url: "https://www.premiumize.me/api/account/info",
      valid: (json) => json?.status === "success",
    },
    cache: {
      url: "https://www.premiumize.me/api/cache/check",
      method: "POST",
      body: (hash) => `items[]=${encodeURIComponent(hash)}`,
      valid: (json) =>
        json?.status === "success" &&
        Array.isArray(json?.response) &&
        json.response.length === 1 &&
        typeof json.response[0] === "boolean",
    },
  },
  {
    id: "torbox",
    label: "TorBox",
    env: "DS_SMOKE_TORBOX_TOKEN",
    account: {
      url: "https://api.torbox.app/v1/api/user/me",
      valid: (json) =>
        json?.success === true && typeof json?.data === "object" && json.data !== null,
    },
    cache: {
      url: (hash) =>
        `https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash}&format=object`,
      valid: (json) =>
        json?.success === true && typeof json?.data === "object" && json.data !== null,
    },
  },
];

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function retryAfterMs(response, now = Date.now()) {
  const raw = response.headers?.get?.("retry-after")?.trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1_000));
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function checkEndpointAttempt(
  { url, valid, method = "GET", body },
  headers,
  fetchImpl,
  timeoutMs,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      return {
        ok: false,
        reason: "http-error",
        status: response.status,
        retryAfterMs: retryAfterMs(response),
      };
    }
    let json;
    try {
      json = await response.json();
    } catch {
      return { ok: false, reason: "invalid-json" };
    }
    const isValid = Boolean(valid(json));
    return {
      ok: isValid,
      ...(!isValid ? { reason: "unexpected-shape" } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "timeout" : "network-error",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkEndpoint(
  { url, valid, method = "GET", body },
  headers,
  fetchImpl,
  timeoutMs,
  sleepImpl,
) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await checkEndpointAttempt(
      { url, valid, method, body },
      headers,
      fetchImpl,
      timeoutMs,
    );
    const shouldRetry =
      attempt === 0 &&
      result.status != null &&
      isRetryableStatus(result.status);
    if (shouldRetry) {
      await sleepImpl(result.retryAfterMs ?? 0);
      continue;
    }
    const { retryAfterMs: _retryAfterMs, ...publicResult } = result;
    return { ...publicResult, durationMs: Date.now() - startedAt };
  }
  throw new Error("unreachable provider smoke retry state");
}

export async function smokeProvider(
  provider,
  token,
  {
    hash = DEFAULT_HASH,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sleepImpl = sleep,
  } = {},
) {
  if (!/^[a-f0-9]{40}$/i.test(hash)) {
    throw new Error("DS_SMOKE_INFO_HASH must be a 40-character hexadecimal info hash");
  }
  const headers = authHeaders(token);
  const account = await checkEndpoint(
    provider.account,
    headers,
    fetchImpl,
    timeoutMs,
    sleepImpl,
  );
  const torrents =
    provider.torrents == null
      ? null
      : account.ok
        ? await checkEndpoint(
            provider.torrents,
            headers,
            fetchImpl,
            timeoutMs,
            sleepImpl,
          )
        : { ok: false, durationMs: 0, reason: "account-failed" };
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
          sleepImpl,
        )
      : provider.cache == null
        ? { ok: null, durationMs: 0, reason: "unsupported" }
        : { ok: false, durationMs: 0, reason: "account-failed" };
  return {
    id: provider.id,
    label: provider.label,
    ok: account.ok && (torrents == null || torrents.ok) && cache.ok !== false,
    account,
    ...(torrents != null ? { torrents } : {}),
    cache,
  };
}

export async function runProviderSmoke({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleepImpl = sleep,
} = {}) {
  const hash = env.DS_SMOKE_INFO_HASH?.trim() || DEFAULT_HASH;
  const configured = PROVIDERS.flatMap((provider) => {
    const token = env[provider.env]?.trim();
    return token ? [{ provider, token }] : [];
  });
  const results = [];
  for (const { provider, token } of configured) {
    results.push(
      await smokeProvider(provider, token, {
        hash,
        fetchImpl,
        timeoutMs,
        sleepImpl,
      }),
    );
  }
  return { configured: configured.length, results };
}

function formatCheck(label, check) {
  if (check.ok === null) {
    return `${label} unavailable (reason ${check.reason ?? "skipped"})`;
  }
  if (check.ok) return `${label} passed (${check.durationMs}ms)`;
  const details = [
    check.status != null ? `status ${check.status}` : null,
    check.reason != null ? `reason ${check.reason}` : null,
    `${check.durationMs}ms`,
  ].filter(Boolean);
  return `${label} failed (${details.join(", ")})`;
}

export function formatProviderResult(result) {
  const checks = [formatCheck("account", result.account)];
  if (result.torrents != null) checks.push(formatCheck("torrents", result.torrents));
  checks.push(formatCheck("cache", result.cache));
  return `${result.ok ? "PASS" : "FAIL"} ${result.label}: ${checks.join(", ")}`;
}

async function main() {
  const report = await runProviderSmoke();
  if (report.configured === 0) {
    console.error("No provider smoke credentials are configured.");
    process.exitCode = 2;
    return;
  }
  for (const result of report.results) {
    console.log(formatProviderResult(result));
  }
  if (report.results.some((result) => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
