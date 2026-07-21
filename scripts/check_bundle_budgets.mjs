#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kib = (value) => value * 1024;

export const DEFAULT_BUNDLE_BUDGETS = Object.freeze({
  web: {
    label: "YAWF Stream app",
    initialRaw: kib(760),
    initialGzip: kib(220),
    initialRequests: 12,
    largestJsRaw: kib(550),
    largestJsGzip: kib(175),
  },
  "website-app": {
    label: "YAWF Stream website",
    initialRaw: kib(780),
    initialGzip: kib(235),
    initialRequests: 3,
    largestJsRaw: kib(960),
    largestJsGzip: kib(265),
  },
});

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function resolveInitialAsset(dist, reference) {
  if (/^(?:data:|https?:|\/\/)/i.test(reference)) return null;
  const pathname = decodeURIComponent(new URL(reference, "https://bundle.invalid/").pathname);
  const clean = pathname.replace(/^\/+/, "");
  const assetsMarker = "/assets/";
  const assetsIndex = pathname.indexOf(assetsMarker);
  const candidates = [resolve(dist, clean)];
  if (assetsIndex >= 0) {
    candidates.push(resolve(dist, "assets", pathname.slice(assetsIndex + assetsMarker.length)));
  }
  candidates.push(resolve(dist, basename(pathname)));

  for (const candidate of candidates) {
    if (isWithin(dist, candidate) && existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`initial asset is missing from the build: ${reference}`);
}

function assetSize(path) {
  const bytes = readFileSync(path);
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

export function measureBundle(app, options = {}) {
  const projectRoot = resolve(options.root ?? root);
  const dist = resolve(projectRoot, app, "dist");
  const htmlPath = join(dist, "index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(`${app} production build is missing: ${relative(projectRoot, htmlPath)}`);
  }

  const html = readFileSync(htmlPath, "utf8");
  const initial = new Set();
  const assetPattern = /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi;
  for (const match of html.matchAll(assetPattern)) {
    const asset = resolveInitialAsset(dist, match[1]);
    if (asset) initial.add(asset);
  }
  if (initial.size === 0) throw new Error(`${app} index.html has no local JavaScript or CSS assets`);

  let initialRaw = 0;
  let initialGzip = 0;
  for (const path of initial) {
    const size = assetSize(path);
    initialRaw += size.raw;
    initialGzip += size.gzip;
  }

  const jsFiles = walkFiles(join(dist, "assets")).filter((path) => path.endsWith(".js"));
  if (jsFiles.length === 0) throw new Error(`${app} build has no JavaScript chunks`);
  const chunks = jsFiles.map((path) => ({
    path,
    ...assetSize(path),
  }));
  const largestRaw = chunks.reduce((largest, chunk) => (chunk.raw > largest.raw ? chunk : largest));
  const largestGzip = chunks.reduce((largest, chunk) =>
    chunk.gzip > largest.gzip ? chunk : largest,
  );

  return {
    app,
    dist,
    initialFiles: [...initial].map((path) => relative(dist, path)).sort(),
    initialRaw,
    initialGzip,
    initialRequests: initial.size,
    largestRaw: { name: relative(dist, largestRaw.path), raw: largestRaw.raw },
    largestGzip: { name: relative(dist, largestGzip.path), gzip: largestGzip.gzip },
  };
}

export function checkBundleBudget(app, options = {}) {
  const budgets = options.budgets ?? DEFAULT_BUNDLE_BUDGETS;
  const budget = budgets[app];
  if (!budget) throw new Error(`no bundle budget is configured for ${app}`);
  const metrics = measureBundle(app, options);
  const failures = [];

  if (metrics.initialRaw > budget.initialRaw) {
    failures.push(
      `initial raw assets are ${formatKib(metrics.initialRaw)}; limit ${formatKib(budget.initialRaw)}`,
    );
  }
  if (metrics.initialGzip > budget.initialGzip) {
    failures.push(
      `initial gzip assets are ${formatKib(metrics.initialGzip)}; limit ${formatKib(budget.initialGzip)}`,
    );
  }
  if (metrics.initialRequests > budget.initialRequests) {
    failures.push(
      `initial local asset requests are ${metrics.initialRequests}; limit ${budget.initialRequests}`,
    );
  }
  if (metrics.largestRaw.raw > budget.largestJsRaw) {
    failures.push(
      `${metrics.largestRaw.name} is ${formatKib(metrics.largestRaw.raw)} raw; JavaScript chunk limit ${formatKib(budget.largestJsRaw)}`,
    );
  }
  if (metrics.largestGzip.gzip > budget.largestJsGzip) {
    failures.push(
      `${metrics.largestGzip.name} is ${formatKib(metrics.largestGzip.gzip)} gzip; JavaScript chunk limit ${formatKib(budget.largestJsGzip)}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`${budget.label} bundle budget failed:\n- ${failures.join("\n- ")}`);
  }

  const log = options.log ?? console.log;
  log(
    `ok   ${budget.label} initial: ${formatKib(metrics.initialRaw)} raw, ${formatKib(metrics.initialGzip)} gzip, ${metrics.initialRequests} requests`,
  );
  log(
    `ok   ${budget.label} largest JavaScript: ${formatKib(metrics.largestRaw.raw)} raw, ${formatKib(metrics.largestGzip.gzip)} gzip`,
  );
  return metrics;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const apps = process.argv.slice(2);
  const requested = apps.length > 0 ? apps : Object.keys(DEFAULT_BUNDLE_BUDGETS);
  try {
    for (const app of requested) checkBundleBudget(app);
  } catch (error) {
    console.error(`fail ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
