#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { get } from "node:https";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tag = "b6.1.1";
const releaseOrigin = "https://github.com";
const releaseBase = `${releaseOrigin}/eugeneware/ffmpeg-static/releases/download/${tag}`;
const minBinaryBytes = 10_000_000;
const platforms = process.argv.slice(2);

const assets = new Map([
  ["darwin-arm64", {
    ffmpeg: ["ffmpeg-darwin-arm64", "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584"],
    ffprobe: ["ffprobe-darwin-arm64", "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64"],
  }],
  ["darwin-x64", {
    ffmpeg: ["ffmpeg-darwin-x64", "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"],
    ffprobe: ["ffprobe-darwin-x64", "fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0"],
  }],
  ["linux-arm64", {
    ffmpeg: ["ffmpeg-linux-arm64", "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce"],
    ffprobe: ["ffprobe-linux-arm64", "d17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8"],
  }],
  ["linux-x64", {
    ffmpeg: ["ffmpeg-linux-x64", "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"],
    ffprobe: ["ffprobe-linux-x64", "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d"],
  }],
  ["win-x64", {
    ffmpeg: ["ffmpeg-win32-x64", "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"],
    ffprobe: ["ffprobe-win32-x64", "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4"],
  }],
  // Windows on Arm can run these x64 binaries through Windows emulation.
  ["win-arm64", {
    ffmpeg: ["ffmpeg-win32-x64", "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"],
    ffprobe: ["ffprobe-win32-x64", "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4"],
  }],
]);

if (platforms.length === 0) {
  console.error("Usage: node scripts/download_ffmpeg.mjs <platform> [platform...]");
  console.error("Examples: darwin-arm64 darwin-x64 linux-x64 win-x64");
  process.exit(1);
}

for (const platform of platforms) {
  if (!assets.has(platform)) {
    console.error(`Unsupported ffmpeg platform: ${platform}`);
    console.error(`Supported platforms: ${Array.from(assets.keys()).join(", ")}`);
    process.exit(1);
  }
}

const cacheDir = join(root, ".build", "ffmpeg", tag);
const destRoot = join(root, "web", "src-tauri", "resources", "ffmpeg");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(destRoot, { recursive: true });

function assertTrustedUrl(url) {
  const parsed = new URL(url);
  const trusted =
    parsed.protocol === "https:" &&
    (parsed.origin === releaseOrigin || parsed.origin === "https://release-assets.githubusercontent.com");
  if (!trusted) {
    throw new Error(`Refusing to download ffmpeg from untrusted URL: ${url}`);
  }
  return parsed;
}

function download(url, dest, redirects = 0) {
  const requestUrl = assertTrustedUrl(url);
  if (redirects > 5) {
    throw new Error(`Too many redirects while downloading ${requestUrl}`);
  }
  const tmp = `${dest}.tmp`;
  rmSync(tmp, { force: true });
  return new Promise((resolve, reject) => {
    const file = createWriteStream(tmp);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      file.close(() => {
        rmSync(tmp, { force: true });
        reject(error);
      });
    };
    file.on("error", fail);
    const request = get(requestUrl, (response) => {
      response.on("error", fail);
      if (
        response.statusCode != null &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        const redirected = new URL(response.headers.location, requestUrl);
        assertTrustedUrl(redirected);
        response.resume();
        file.close(() => {
          rmSync(tmp, { force: true });
          download(redirected.toString(), dest, redirects + 1).then(resolve, reject);
        });
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        fail(new Error(`Download failed ${response.statusCode}: ${requestUrl}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          settled = true;
          renameSync(tmp, dest);
          resolve();
        });
      });
    });
    request.setTimeout(60_000, () => {
      request.destroy(new Error(`Timed out downloading ${requestUrl}`));
    });
    request.on("error", fail);
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function binaryIsUsable(path, expectedHash) {
  try {
    return statSync(path).size >= minBinaryBytes && sha256(path) === expectedHash;
  } catch {
    return false;
  }
}

async function ensureAsset(assetName, expectedHash) {
  const cached = join(cacheDir, assetName);
  if (!binaryIsUsable(cached, expectedHash)) {
    rmSync(cached, { force: true });
    console.log(`Downloading ${basename(cached)}...`);
    await download(`${releaseBase}/${assetName}`, cached);
  }
  if (!binaryIsUsable(cached, expectedHash)) {
    rmSync(cached, { force: true });
    throw new Error(`SHA-256 verification failed for ${assetName}`);
  }
  return cached;
}

for (const platform of platforms) {
  const platformAssets = assets.get(platform);
  const dest = join(destRoot, platform);
  mkdirSync(dest, { recursive: true });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const [assetName, expectedHash] = platformAssets[tool];
    const cached = await ensureAsset(assetName, expectedHash);
    const fileName = platform.startsWith("win-") ? `${tool}.exe` : tool;
    const output = join(dest, fileName);
    if (!existsSync(output) || !binaryIsUsable(output, expectedHash)) {
      copyFileSync(cached, output);
    }
    if (!platform.startsWith("win-")) chmodSync(output, 0o755);
  }
  console.log(`Prepared ffmpeg ${tag} tools for ${platform}.`);
}
