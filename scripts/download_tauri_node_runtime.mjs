#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { get } from "node:https";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const version = (process.env.NODE_RUNTIME_VERSION ?? process.versions.node).replace(/^v/, "");
const platforms = process.argv.slice(2);

if (platforms.length === 0) {
  console.error("Usage: node scripts/download_tauri_node_runtime.mjs <platform> [platform...]");
  console.error("Examples: darwin-arm64 darwin-x64 linux-x64 win-x64");
  process.exit(1);
}

const cacheDir = join(root, ".build", "node-runtime");
const destRoot = join(root, "web", "src-tauri", "resources", "server", "node");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(destRoot, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, (response) => {
      if (
        response.statusCode != null &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close();
        download(response.headers.location, dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed ${response.statusCode}: ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (error) => {
      file.close();
      reject(error);
    });
  });
}

function archiveName(platform) {
  const ext = platform.startsWith("win-") ? "zip" : "tar.xz";
  return `node-v${version}-${platform}.${ext}`;
}

function extract(archive, platform) {
  const extractDir = join(cacheDir, `extract-${platform}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (platform.startsWith("win-")) {
    if (process.platform === "win32") {
      execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${JSON.stringify(archive)} -DestinationPath ${JSON.stringify(extractDir)} -Force`,
      ]);
    } else {
      execFileSync("unzip", ["-q", archive, "-d", extractDir]);
    }
  } else {
    execFileSync("tar", ["-xJf", archive, "-C", extractDir]);
  }

  const source = join(extractDir, `node-v${version}-${platform}`);
  if (!existsSync(source)) {
    throw new Error(`Extracted Node directory not found: ${source}`);
  }

  const dest = join(destRoot, platform);
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true });
  console.log(`Prepared Node ${version} runtime for ${platform}.`);
}

for (const platform of platforms) {
  const file = archiveName(platform);
  const archive = join(cacheDir, file);
  const url = `https://nodejs.org/dist/v${version}/${file}`;
  if (!existsSync(archive)) {
    console.log(`Downloading ${basename(archive)}...`);
    await download(url, archive);
  }
  extract(archive, platform);
}
