#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "website-app");
const dist = join(source, "dist");
const failures = [];

function read(path) {
  return readFileSync(join(source, path), "utf8");
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const app = read("src/App.tsx");
const hero = read("src/pages/home/Hero.tsx");
const features = read("src/pages/features/shared.tsx");
const site = read("src/lib/site.ts");
const tauri = JSON.parse(readFileSync(join(root, "web/src-tauri/tauri.conf.json"), "utf8"));

check(app.includes('basename="/debridstreamer"'), "BrowserRouter must use the /debridstreamer basename");
check(hero.includes("Your Accounts. Watch Freely."), "home hero must use the YAWF Stream headline");
check(hero.includes("A private streaming hub for the services you already use."), "home hero must use the private-hub positioning");
check(!features.includes("id: 'assistant'"), "features must not expose the Assistant chapter by default");
check(site.includes(`v${tauri.version}-web`), "website version must match the Tauri release version");

for (const asset of [
  "hero-streams-loop.mp4",
  "hero-streams-poster.jpg",
  "discover-desktop.png",
  "discover-tablet.png",
  "settings-mobile.png",
  "brand/logo-mark.svg",
]) {
  const file = join(source, "public", asset);
  check(existsSync(file), `website asset missing: ${asset}`);
  if (existsSync(file)) check(statSync(file).size > 0, `website asset is empty: ${asset}`);
}

const sourceFiles = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.(?:ts|tsx|css|html|md|js|json)$/.test(entry.name) && entry.name !== "package-lock.json") sourceFiles.push(path);
  }
}
collect(join(source, "src"));
for (const name of ["index.html", "README.md", "info.md", "package.json", "vite.config.ts"]) {
  const path = join(source, name);
  if (existsSync(path)) sourceFiles.push(path);
}

for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  check(!text.includes("\u2014"), `${file.slice(source.length + 1)} contains an em dash`);
}

check(existsSync(join(dist, "index.html")), "website-app/dist is missing; run npm run build in website-app");
if (existsSync(join(dist, "index.html"))) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  check(html.includes("/debridstreamer/assets/"), "built assets must stay under /debridstreamer/");
  check(html.includes("YAWF Stream"), "built metadata must use YAWF Stream");
}

if (failures.length > 0) {
  console.error("YAWF Stream website check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("YAWF Stream website check passed.");
