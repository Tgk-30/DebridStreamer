#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checks = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const tauri = JSON.parse(read("web/src-tauri/tauri.conf.json"));
const updater = tauri.plugins?.updater;
check(
  "Tauri updater artifacts enabled",
  tauri.bundle?.createUpdaterArtifacts === true,
  "web/src-tauri/tauri.conf.json must set bundle.createUpdaterArtifacts to true",
);
check(
  "Tauri updater endpoint",
  Array.isArray(updater?.endpoints) &&
    updater.endpoints.some((url) => /releases\/latest\/download\/latest\.json$/.test(url)),
  "web/src-tauri/tauri.conf.json must point at latest.json",
);
check(
  "Tauri updater public key",
  typeof updater?.pubkey === "string" && updater.pubkey.trim().length > 40,
  "web/src-tauri/tauri.conf.json must include the updater public key",
);

const releaseWorkflow = read(".github/workflows/web-release.yml");
const dockerWorkflow = read(".github/workflows/docker-image.yml");
check(
  "Release workflow emits updater JSON",
  /includeUpdaterJson:\s*true/.test(releaseWorkflow),
  ".github/workflows/web-release.yml should publish latest.json",
);
check(
  "Release workflow signs updater artifacts",
  /TAURI_SIGNING_PRIVATE_KEY/.test(releaseWorkflow),
  "TAURI_SIGNING_PRIVATE_KEY must be wired into the release workflow",
);
check(
  "Release workflow packages desktop server",
  /prepare_tauri_server_resources\.mjs/.test(releaseWorkflow) &&
    /download_tauri_node_runtime\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml should package the server bundle and Node runtime",
);

check(
  "Website exists",
  existsSync(join(root, "website/index.html")) &&
    existsSync(join(root, "website/app.js")) &&
    existsSync(join(root, "website/styles.css")),
  "website/ must contain the static download site",
);
check(
  "GitHub Pages workflow exists",
  existsSync(join(root, ".github/workflows/site.yml")),
  ".github/workflows/site.yml must publish the downloader site",
);
check(
  "PWA manifest exists",
  existsSync(join(root, "web/public/manifest.webmanifest")) &&
    existsSync(join(root, "web/public/sw.js")),
  "web/public must contain manifest.webmanifest and sw.js",
);
check(
  "Server Docker packaging exists",
  existsSync(join(root, "Dockerfile")) &&
    existsSync(join(root, "deploy/compose/docker-compose.yml")),
  "Dockerfile and deploy/compose/docker-compose.yml are required for Server Mode",
);
check(
  "Docker user guide exists",
  existsSync(join(root, "docs/DOCKER.md")),
  "docs/DOCKER.md should explain Docker/GHCR setup and persistent data",
);
check(
  "Multi-arch Docker workflow exists",
  /docker\/build-push-action@v6/.test(dockerWorkflow) &&
    /platforms:\s*linux\/amd64,linux\/arm64/.test(dockerWorkflow) &&
    /ghcr\.io/.test(dockerWorkflow),
  ".github/workflows/docker-image.yml must publish linux/amd64 and linux/arm64 images to GHCR",
);
check(
  "Desktop server resource scripts exist",
  existsSync(join(root, "scripts/prepare_tauri_server_resources.mjs")) &&
    existsSync(join(root, "scripts/download_tauri_node_runtime.mjs")),
  "scripts must prepare desktop server resources and Node runtimes",
);
check(
  "OSS support docs exist",
  existsSync(join(root, "CONTRIBUTING.md")) &&
    existsSync(join(root, "SECURITY.md")) &&
    existsSync(join(root, ".github/ISSUE_TEMPLATE/bug_report.yml")) &&
    existsSync(join(root, ".github/ISSUE_TEMPLATE/install_support.yml")),
  "CONTRIBUTING.md, SECURITY.md, and issue templates are required for public release readiness",
);

const failed = checks.filter((item) => !item.pass);
for (const item of checks) {
  const mark = item.pass ? "ok" : "fail";
  console.log(`${mark.padEnd(4)} ${item.name}`);
  if (!item.pass) console.log(`     ${item.detail}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} release readiness check(s) failed.`);
  process.exit(1);
}

console.log("\nRelease readiness checks passed.");
