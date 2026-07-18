#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(name, pass, detail) {
  checks.push({ name, pass, detail });
}

function workflowHasFullHistoryCheckout(workflow) {
  return /uses:\s*actions\/checkout@v4[\s\S]{0,240}fetch-depth:\s*0/.test(workflow);
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
check(
  "Tauri bundles recursive server resources",
  Array.isArray(tauri.bundle?.resources) &&
    tauri.bundle.resources.includes("resources/server/**/*"),
  "web/src-tauri/tauri.conf.json must recursively include resources/server so web-dist and Node runtime are bundled",
);

const releaseWorkflow = read(".github/workflows/web-release.yml");
const dockerWorkflow = read(".github/workflows/docker-image.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
const cloudflareSiteWorkflow = read(".github/workflows/cloudflare-site.yml");
const dockerIgnore = read(".dockerignore");
const publicRepoPreflight = read("scripts/public_repo_preflight.mjs");
const cloudflareDeployHelper = read("scripts/deploy_website_cloudflare.mjs");
const swiftTestVerifier = read("scripts/check_swift_tests.mjs");
const nodeRuntimeDownloader = read("scripts/download_tauri_node_runtime.mjs");
const serverResourcePrep = read("scripts/prepare_tauri_server_resources.mjs");
const desktopServerSmoke = read("scripts/smoke_tauri_server_bundle.mjs");
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
  "Release workflow builds macOS, Linux, and Windows",
  // A pinned stable macOS (macos-15/14/13) is REQUIRED - `macos-latest` moved to
  // the macOS 26 beta, whose SDK/codesign makes bundles "damaged" on older macOS.
  /platform:\s*macos-\d+/.test(releaseWorkflow) &&
    /platform:\s*ubuntu-\d+\.\d+/.test(releaseWorkflow) &&
    /platform:\s*windows-latest/.test(releaseWorkflow) &&
    /runs-on:\s*\$\{\{\s*matrix\.platform\s*\}\}/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must run the desktop release job on macOS, Linux, and Windows",
);
check(
  "Release workflow builds per-arch macOS targets",
  // macOS ships PER-ARCH now (native runners, each bundling its own libmpv) - 
  // no universal/lipo build. Verify both arch targets flow through matrix.args.
  /--target aarch64-apple-darwin/.test(releaseWorkflow) &&
    /--target x86_64-apple-darwin/.test(releaseWorkflow) &&
    /args:\s*\$\{\{\s*matrix\.args\s*\}\}/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must build per-arch macOS (aarch64 + x86_64) targets via matrix.args",
);
check(
  "Release workflow packages desktop server",
  /prepare_tauri_server_resources\.mjs/.test(releaseWorkflow) &&
    /download_tauri_node_runtime\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml should package the server bundle and Node runtime",
);
check(
  "Release workflow runs public preflight",
  /public_repo_preflight\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must run the public repo preflight before publishing assets",
);
check(
  "Release workflow public preflight uses full Git history",
  workflowHasFullHistoryCheckout(releaseWorkflow),
  ".github/workflows/web-release.yml must checkout with fetch-depth: 0 before running public repo preflight",
);
check(
  "Release workflow validates website",
  /check_website_download_logic\.mjs/.test(releaseWorkflow) &&
    /check_website_static\.mjs/.test(releaseWorkflow) &&
    /check_website_path_mount\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must validate website download logic, static page QA, and mounted-path QA before publishing assets",
);
check(
  "Release workflow runs app responsive contract",
  /check_app_responsive_contract\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must run the app responsive contract before publishing desktop release assets",
);
check(
  "Release workflow runs web and server tests",
  /working-directory:\s*web[\s\S]*?run:\s*npm test/.test(releaseWorkflow) &&
    /working-directory:\s*server[\s\S]*?run:\s*npm test/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must run the web and server unit suites before publishing release assets",
);
check(
  "Swift test verifier handles local VLCKit runtime",
  existsSync(join(root, "scripts/check_swift_tests.mjs")) &&
    /--build-tests/.test(swiftTestVerifier) &&
    /--skip-build/.test(swiftTestVerifier) &&
    /PackageFrameworks/.test(swiftTestVerifier) &&
    /known SwiftPM\/VLCKit teardown crash/.test(swiftTestVerifier),
  "scripts/check_swift_tests.mjs must build tests in a scratch path, expose VLCKit on the test rpath, and tolerate only the known teardown crash",
);
check(
  "Release workflow validates updater signing secret",
  /Validate updater signing secret/.test(releaseWorkflow) &&
    /TAURI_SIGNING_PRIVATE_KEY/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must fail early when the updater signing private key is missing",
);
check(
  "Release workflow validates macOS signing secrets",
  /Validate macOS signing secrets/.test(releaseWorkflow) &&
    [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
    ].every((secret) => releaseWorkflow.includes(secret)),
  ".github/workflows/web-release.yml must fail early when Developer ID/notarization secrets are missing",
);
check(
  "Release workflow bundles macOS Node runtimes",
  // Per-arch: each mac job downloads only its own runtime via matrix.node_runtime,
  // and both arches are present across the matrix.
  /node_runtime:\s*darwin-arm64/.test(releaseWorkflow) &&
    /node_runtime:\s*darwin-x64/.test(releaseWorkflow) &&
    /download_tauri_node_runtime\.mjs \$\{\{ matrix\.node_runtime \}\}/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must bundle darwin-arm64 and darwin-x64 Node runtimes across the per-arch mac matrix",
);
check(
  "Release workflow bundles Linux Node runtime",
  /download_tauri_node_runtime\.mjs\s+linux-x64/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must bundle a linux-x64 Node runtime for the Linux desktop app",
);
check(
  "Release workflow bundles Windows Node runtime",
  /download_tauri_node_runtime\.mjs\s+win-x64/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must bundle a win-x64 Node runtime for the Windows desktop app",
);
check(
  "Release workflow bundles ffmpeg binaries",
  // The optimize/remux engine shells out to bundled ffmpeg/ffprobe, so every
  // desktop target must fetch them exactly like the Node runtime above: macOS
  // per-arch via matrix.node_runtime, Linux and Windows literally.
  /download_ffmpeg\.mjs \$\{\{ matrix\.node_runtime \}\}/.test(releaseWorkflow) &&
    /download_ffmpeg\.mjs\s+linux-x64/.test(releaseWorkflow) &&
    /download_ffmpeg\.mjs\s+win-x64/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must fetch ffmpeg/ffprobe for macOS (per-arch), Linux, and Windows before packaging",
);
check(
  "Tauri bundles ffmpeg resources",
  // Fetching the binaries is not enough - tauri.conf.json must ship them so
  // they are present in the packaged app next to the Node runtime.
  Array.isArray(tauri.bundle?.resources) &&
    tauri.bundle.resources.includes("resources/ffmpeg/**/*"),
  "web/src-tauri/tauri.conf.json must recursively include resources/ffmpeg so bundled ffmpeg/ffprobe binaries ship with the app",
);
check(
  "Local package script bundles current-platform Node",
  /download_tauri_node_runtime\.mjs/.test(read("scripts/package_tauri_local.mjs")) &&
    /nodeRuntimePlatform/.test(read("scripts/package_tauri_local.mjs")),
  "scripts/package_tauri_local.mjs must bundle the current-platform Node runtime before Tauri packaging",
);
check(
  "Local package script creates macOS app zip",
  /--bundles/.test(read("scripts/package_tauri_local.mjs")) &&
    /app\.zip/.test(read("scripts/package_tauri_local.mjs")) &&
    /ditto/.test(read("scripts/package_tauri_local.mjs")),
  "scripts/package_tauri_local.mjs must build a local macOS .app bundle and zip it without relying on DMG post-processing",
);
check(
  "Local package artifact verifier exists",
  existsSync(join(root, "scripts/check_local_package_artifact.mjs")) &&
    /--require-current/.test(read("scripts/check_local_package_artifact.mjs")) &&
    /sha256/.test(read("scripts/check_local_package_artifact.mjs")),
  "scripts/check_local_package_artifact.mjs must verify local package artifact freshness, size, and checksum",
);
check(
  "Node runtime downloader is origin-restricted",
  /nodeDistOrigin\s*=\s*"https:\/\/nodejs\.org"/.test(nodeRuntimeDownloader) &&
    /assertNodeDistUrl/.test(nodeRuntimeDownloader) &&
    /Too many redirects/.test(nodeRuntimeDownloader),
  "scripts/download_tauri_node_runtime.mjs must only download runtimes from nodejs.org and bound redirects",
);
check(
  "Node runtime downloader rejects incomplete archives",
  /minArchiveBytes/.test(nodeRuntimeDownloader) &&
    /statSync\(archive\)\.size\s*>=\s*minArchiveBytes/.test(nodeRuntimeDownloader),
  "scripts/download_tauri_node_runtime.mjs must reject empty or truncated cached Node archives",
);
check(
  "Node runtime downloader verifies archive checksums",
  /SHASUMS256\.txt/.test(nodeRuntimeDownloader) &&
    /createHash\("sha256"\)/.test(nodeRuntimeDownloader) &&
    /SHA-256 mismatch/.test(nodeRuntimeDownloader),
  "scripts/download_tauri_node_runtime.mjs must verify downloaded Node archives against Node release SHASUMS",
);
check(
  "Server resource prep is cwd-independent",
  /fileURLToPath\(import\.meta\.url\)/.test(serverResourcePrep) &&
    !/const root = process\.cwd\(\)/.test(serverResourcePrep),
  "scripts/prepare_tauri_server_resources.mjs must resolve the repo root from its own path, not the caller cwd",
);

check(
  "Website exists",
  existsSync(join(root, "website/index.html")) &&
    existsSync(join(root, "website/app.js")) &&
    existsSync(join(root, "website/styles.css")),
  "website/ must contain the static download site",
);
check(
  "Cinematic YAWF Stream website exists",
  existsSync(join(root, "website-app/package.json")) &&
    existsSync(join(root, "website-app/src/pages/home/Hero.tsx")) &&
    existsSync(join(root, "website-app/public/hero-streams-loop.mp4")),
  "website-app must contain the cinematic YAWF Stream Sites build and its hero media",
);
check(
  "Release workflow validates the cinematic website",
  /working-directory:\s*website-app/.test(releaseWorkflow) &&
    /check_website_app\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must build and validate website-app before packaging",
);
check(
  "Website product preview media exists",
  existsSync(join(root, "scripts/generate_website_media.mjs")) &&
    existsSync(join(root, "website/media/discover-desktop.png")) &&
    existsSync(join(root, "website/media/discover-tablet.png")) &&
    existsSync(join(root, "website/media/settings-mobile.png")),
  "website media must include product preview images for the first-viewport documentation site",
);
check(
  "Website download logic check exists",
  existsSync(join(root, "scripts/check_website_download_logic.mjs")),
  "scripts/check_website_download_logic.mjs must verify platform detection and release asset matching",
);
check(
  "Website static check exists",
  existsSync(join(root, "scripts/check_website_static.mjs")),
  "scripts/check_website_static.mjs must verify anchors, local assets, stale copy, and responsive site safeguards",
);
check(
  "Website mounted-path check exists",
  existsSync(join(root, "scripts/check_website_path_mount.mjs")),
  "scripts/check_website_path_mount.mjs must verify website/ assets and Worker routing work under tgk30.com/debridstreamer/",
);
check(
  "Cloudflare path deploy helper exists",
  existsSync(join(root, "scripts/deploy_website_cloudflare.mjs")) &&
    /workers\/routes/.test(cloudflareDeployHelper) &&
    /wrangler@latest/.test(cloudflareDeployHelper),
  "scripts/deploy_website_cloudflare.mjs must deploy website/ to Cloudflare Pages and route tgk30.com/debridstreamer* through a Worker",
);
check(
  "Cloudflare path deploy helper validates mounted-path safety",
  /check_website_download_logic\.mjs/.test(cloudflareDeployHelper) &&
    /check_website_static\.mjs/.test(cloudflareDeployHelper) &&
    /check_website_path_mount\.mjs/.test(cloudflareDeployHelper) &&
    /public_repo_preflight\.mjs/.test(cloudflareDeployHelper),
  "scripts/deploy_website_cloudflare.mjs must run download, static, mounted-path, and public-repo checks before mutating Cloudflare",
);
// GitHub Pages (site.yml) was removed 2026-07 - Pages was never enabled and
// Cloudflare (cloudflare-site.yml, checked below) is the deploy that counts.
check(
  "Legacy GitHub Pages workflow stays deleted",
  !existsSync(join(root, ".github/workflows/site.yml")),
  ".github/workflows/site.yml is dead legacy - the Cloudflare workflow owns the site deploy",
);
check(
  "Cloudflare site workflow exists",
  existsSync(join(root, ".github/workflows/cloudflare-site.yml")),
  ".github/workflows/cloudflare-site.yml must deploy tgk30.com/debridstreamer through Cloudflare",
);
check(
  "Cloudflare site workflow validates website",
  /public_repo_preflight\.mjs/.test(cloudflareSiteWorkflow) &&
    /check_website_download_logic\.mjs/.test(cloudflareSiteWorkflow) &&
    /check_website_static\.mjs/.test(cloudflareSiteWorkflow) &&
    /check_website_path_mount\.mjs/.test(cloudflareSiteWorkflow),
  ".github/workflows/cloudflare-site.yml must run public repo preflight, website download logic, static site QA, and mounted-path QA before deploy",
);
check(
  "Cloudflare site workflow public preflight uses full Git history",
  workflowHasFullHistoryCheckout(cloudflareSiteWorkflow),
  ".github/workflows/cloudflare-site.yml must checkout with fetch-depth: 0 before running public repo preflight",
);
check(
  "Cloudflare site workflow deploys mounted path",
  /Validate Cloudflare token secret/.test(cloudflareSiteWorkflow) &&
    /CLOUDFLARE_API_TOKEN/.test(cloudflareSiteWorkflow) &&
    /deploy_website_cloudflare\.mjs/.test(cloudflareSiteWorkflow) &&
    /tgk30\.com\/debridstreamer/.test(cloudflareSiteWorkflow),
  ".github/workflows/cloudflare-site.yml must validate the Cloudflare token secret and run the Cloudflare deploy helper for tgk30.com/debridstreamer",
);
check(
  "Cloudflare site workflow watches site dependencies",
  [
    "website/**",
    "web/public/icons/**",
    "scripts/check_website_download_logic.mjs",
    "scripts/check_website_static.mjs",
    "scripts/check_website_path_mount.mjs",
    "scripts/deploy_website_cloudflare.mjs",
    "scripts/public_repo_preflight.mjs",
  ].every((path) => cloudflareSiteWorkflow.includes(path)),
  ".github/workflows/cloudflare-site.yml paths must include website assets and all Cloudflare site validation/deploy scripts",
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
  "Docker workflow runs public preflight",
  /public_repo_preflight\.mjs/.test(dockerWorkflow) &&
    /check_release_readiness\.mjs/.test(dockerWorkflow),
  ".github/workflows/docker-image.yml must run public repo preflight and release readiness before publishing images",
);
check(
  "Docker workflow public preflight uses full Git history",
  workflowHasFullHistoryCheckout(dockerWorkflow),
  ".github/workflows/docker-image.yml must checkout with fetch-depth: 0 before running public repo preflight",
);
check(
  "Docker workflow watches publish gates",
  [
    "Dockerfile",
    ".dockerignore",
    "scripts/check_release_readiness.mjs",
    "scripts/public_repo_preflight.mjs",
    "server/**",
    "web/**",
  ].every((path) => dockerWorkflow.includes(path)),
  ".github/workflows/docker-image.yml paths must include Docker inputs plus readiness/security scripts",
);
check(
  "Docker context excludes local assistant and secret files",
  [
    ".claude",
    ".codex",
    ".cursor",
    ".windsurf",
    ".continue",
    ".gemini",
    ".opencode",
    ".aider*",
    "CLAUDE.md",
    "CODEX.md",
    "GEMINI.md",
    "AGENTS.md",
    "AGENT.md",
    ".env",
  ].every((pattern) => dockerIgnore.includes(pattern)),
  ".dockerignore must exclude local assistant files, transcripts, and env files from Docker build contexts",
);
check(
  "Public repo security preflight exists",
  existsSync(join(root, "scripts/public_repo_preflight.mjs")),
  "scripts/public_repo_preflight.mjs must exist to scan for tracked assistant files, transcripts, and likely credentials",
);
check(
  "App responsive contract exists",
  existsSync(join(root, "scripts/check_app_responsive_contract.mjs")),
  "scripts/check_app_responsive_contract.mjs must exist to guard mobile nav, settings selector, and setup wizard responsive contracts",
);
check(
  "Public repo preflight scans Git history",
  /rev-list/.test(publicRepoPreflight) &&
    /--objects/.test(publicRepoPreflight) &&
    /cat-file/.test(publicRepoPreflight) &&
    /commit message/.test(publicRepoPreflight),
  "scripts/public_repo_preflight.mjs must scan reachable history blobs and commit messages before public pushes",
);
check(
  "Public repo preflight can scan all refs",
  /--all-refs/.test(publicRepoPreflight) &&
    /historyScopeArgs/.test(publicRepoPreflight),
  "scripts/public_repo_preflight.mjs must support --all-refs before pushing multiple branches or tags to a public remote",
);
check(
  "Public repo preflight catches generic provider keys",
  /sk-\[A-Za-z0-9_-\]\{20,\}/.test(publicRepoPreflight) &&
    /zai\|z\\\.ai/.test(publicRepoPreflight),
  "scripts/public_repo_preflight.mjs must catch generic sk-prefixed provider keys, including Z.AI/GLM-style keys",
);
check(
  "CI runs public and website gates",
  /public_repo_preflight\.mjs/.test(ciWorkflow) &&
    /check_release_readiness\.mjs/.test(ciWorkflow) &&
    /check_website_download_logic\.mjs/.test(ciWorkflow) &&
    /check_website_static\.mjs/.test(ciWorkflow) &&
    /check_website_path_mount\.mjs/.test(ciWorkflow),
  ".github/workflows/ci.yml must run public repo, release readiness, website download, static website, and mounted-path checks",
);
check(
  "CI public preflight uses full Git history",
  workflowHasFullHistoryCheckout(ciWorkflow),
  ".github/workflows/ci.yml must checkout with fetch-depth: 0 before running public repo preflight",
);
check(
  "CI runs app responsive contract",
  /check_app_responsive_contract\.mjs/.test(ciWorkflow),
  ".github/workflows/ci.yml must run scripts/check_app_responsive_contract.mjs so mobile nav, settings selectors, and setup wizard defaults cannot regress",
);
check(
  "CI runs Swift test verifier",
  /check_swift_tests\.mjs/.test(ciWorkflow),
  ".github/workflows/ci.yml must run scripts/check_swift_tests.mjs for native Swift tests",
);
check(
  "Desktop server resource scripts exist",
  existsSync(join(root, "scripts/prepare_tauri_server_resources.mjs")) &&
    existsSync(join(root, "scripts/download_tauri_node_runtime.mjs")) &&
    existsSync(join(root, "scripts/smoke_tauri_server_bundle.mjs")),
  "scripts must prepare desktop server resources, Node runtimes, and smoke the packaged server bundle",
);
check(
  "Release workflow smokes desktop server bundle",
  /smoke_tauri_server_bundle\.mjs/.test(releaseWorkflow),
  ".github/workflows/web-release.yml must boot the prepared desktop server bundle before publishing release assets",
);
check(
  "CI smokes desktop server bundle",
  /smoke_tauri_server_bundle\.mjs/.test(ciWorkflow) &&
    /download_tauri_node_runtime\.mjs linux-x64/.test(ciWorkflow),
  ".github/workflows/ci.yml must boot the prepared desktop server bundle with a bundled Node runtime",
);
check(
  "Local package script smokes packaged app",
  /smoke_tauri_server_bundle\.mjs/.test(read("scripts/package_tauri_local.mjs")),
  "scripts/package_tauri_local.mjs must smoke the packaged app after local Tauri packaging",
);
check(
  "Desktop server smoke follows the branded app name",
  /tauriConfig\.productName/.test(desktopServerSmoke) &&
    !/macos",\s*"DebridStreamer\.app"/.test(desktopServerSmoke),
  "scripts/smoke_tauri_server_bundle.mjs must resolve the macOS app from tauri.conf.json productName",
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
