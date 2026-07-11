#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const website = join(root, "website");
const html = readFileSync(join(website, "index.html"), "utf8");
const css = readFileSync(join(website, "styles.css"), "utf8");
const js = readFileSync(join(website, "app.js"), "utf8");
const failures = [];
// Real app captures (pngquant-compressed), not drawn placeholders — byte
// ranges sized for photographic poster/backdrop content at the pinned dims.
const expectedGeneratedMedia = {
  "media/discover-desktop.png": { width: 1440, height: 848, minBytes: 20_000, maxBytes: 360_000 },
  "media/discover-tablet.png": { width: 768, height: 1196, minBytes: 20_000, maxBytes: 320_000 },
  "media/settings-mobile.png": { width: 390, height: 792, minBytes: 8_000, maxBytes: 140_000 },
};

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function attrsFrom(tag) {
  const attrs = {};
  const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = attrRe.exec(tag)) != null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function tags(name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => ({
    raw: match[0],
    attrs: attrsFrom(match[0]),
  }));
}

function localPath(value) {
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:")
  ) {
    return null;
  }
  return value.split(/[?#]/)[0];
}

function assertLocalFile(value, context) {
  const path = localPath(value);
  if (!path) return;
  const resolved = normalize(join(website, path));
  const fromWebsite = relative(website, resolved);
  if (fromWebsite.startsWith("..") || fromWebsite.startsWith("/") || fromWebsite.startsWith("\\")) {
    fail(`${context} escapes website/: ${value}`);
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    fail(`${context} missing local file: ${value}`);
  }
}

function srcsetUrls(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function pngDimensions(file) {
  const header = readFileSync(file).subarray(0, 24);
  if (
    header.length < 24 ||
    header[0] !== 0x89 ||
    header[1] !== 0x50 ||
    header[2] !== 0x4e ||
    header[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const idSet = new Set(ids);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
check(duplicateIds.length === 0, `duplicate ids: ${[...new Set(duplicateIds)].join(", ")}`);

for (const image of tags("img")) {
  assertLocalFile(image.attrs.src, `image ${image.attrs.src ?? ""}`);
  for (const src of srcsetUrls(image.attrs.srcset)) {
    assertLocalFile(src, `image srcset ${src}`);
  }
  const hidden = /aria-hidden="true"/i.test(image.raw) || /alt=""/.test(image.raw);
  check(hidden || (image.attrs.alt ?? "").trim().length > 0, `visible image needs alt text: ${image.raw}`);
}

for (const source of tags("source")) {
  for (const src of srcsetUrls(source.attrs.srcset)) {
    assertLocalFile(src, `source srcset ${src}`);
  }
}

for (const link of tags("link")) {
  assertLocalFile(link.attrs.href, `link ${link.attrs.href ?? ""}`);
}

for (const script of tags("script")) {
  assertLocalFile(script.attrs.src, `script ${script.attrs.src ?? ""}`);
}

for (const anchor of tags("a")) {
  const href = anchor.attrs.href ?? "";
  if (href.startsWith("#")) {
    const id = href.slice(1);
    check(idSet.has(id), `anchor target not found: ${href}`);
  }
  if (href.startsWith("http://")) {
    fail(`external link must use https: ${href}`);
  }
}

for (const button of tags("button")) {
  const target = button.attrs["data-copy-target"];
  if (target) {
    check(idSet.has(target), `copy target not found: ${target}`);
  }
}

for (const key of ["mac", "windows", "linux"]) {
  check(html.includes(`data-download="${key}"`), `missing ${key} download link hook`);
  if (key === "mac") {
    check(
      html.includes('data-download-meta="mac-arm64"') &&
        html.includes('data-download-meta="mac-x64"'),
      "missing per-architecture mac download metadata hooks",
    );
  } else {
    check(html.includes(`data-download-meta="${key}"`), `missing ${key} download metadata hook`);
  }
  check(js.includes(`${key}: {`), `missing ${key} platform config in app.js`);
}

const localSources = [
  ...tags("img").map((tag) => tag.attrs.src).filter(Boolean),
  ...tags("img").flatMap((tag) => srcsetUrls(tag.attrs.srcset)),
  ...tags("source").flatMap((tag) => srcsetUrls(tag.attrs.srcset)),
  ...tags("link").map((tag) => tag.attrs.href).filter(Boolean),
  ...tags("script").map((tag) => tag.attrs.src).filter(Boolean),
]
  .map(localPath)
  .filter(Boolean);

for (const source of localSources) {
  const extension = extname(source).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) {
    const file = join(website, source);
    if (existsSync(file)) {
      const size = statSync(file).size;
      check(size > 1024, `image asset looks empty: ${relative(root, file)}`);
      check(size < 1_500_000, `image asset is too large for the static site: ${relative(root, file)}`);
    }
  }
}

for (const [source, expected] of Object.entries(expectedGeneratedMedia)) {
  const file = join(website, source);
  check(existsSync(file), `generated media missing: website/${source}`);
  if (!existsSync(file)) continue;
  const size = statSync(file).size;
  check(
    size >= expected.minBytes && size <= expected.maxBytes,
    `generated media has unexpected byte size: website/${source} (${size} bytes)`,
  );
  const dimensions = pngDimensions(file);
  check(dimensions != null, `generated media must be a PNG: website/${source}`);
  if (dimensions != null) {
    check(
      dimensions.width === expected.width && dimensions.height === expected.height,
      `generated media has unexpected dimensions: website/${source} (${dimensions.width}x${dimensions.height})`,
    );
  }
}

const stalePatterns = [
  /Dev preview/i,
  /sample catalog/i,
  /VITE_TMDB_KEY/i,
  /CLAUDE\.md/i,
  /AGENTS?\.md/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bcfat_[A-Za-z0-9_-]{20,}\b/,
  /\b[0-9a-f]{32,}\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b[A-Z0-9]{40,}\b/,
];
for (const pattern of stalePatterns) {
  check(!pattern.test(html) && !pattern.test(css) && !pattern.test(js), `stale/private text matched ${pattern}`);
}

check(/<meta name="theme-color" content="#050505"/.test(html), "theme-color must stay pitch black");
check(/--site-bg:\s*#050505/.test(css), "site background token must stay pitch black");
check(/@media\s*\(max-width:\s*960px\)/.test(css), "missing tablet breakpoint");
check(/@media\s*\(max-width:\s*640px\)/.test(css), "missing mobile breakpoint");
check(/@media\s*\(max-width:\s*360px\)/.test(css), "missing narrow-phone breakpoint");
check(/nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css), "mobile nav must use a stable 3-column grid");
check(/\.hero-actions\s*\{[\s\S]*grid-template-columns:\s*1fr/.test(css), "narrow-phone hero actions must stack");
check(/scroll-margin-top/.test(css), "sections need scroll margins for header navigation");
check(/focus-visible/.test(css), "keyboard focus state is required");
check(/overflow-wrap:\s*anywhere/.test(css), "long filenames and command text need overflow wrapping");

if (failures.length > 0) {
  console.error("Website static check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Website static check passed.");
