#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const server = join(root, "server");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function nodeRuntimePlatform() {
  const os = process.platform;
  const arch = process.arch;
  if (os === "darwin" && arch === "arm64") return "darwin-arm64";
  if (os === "darwin" && arch === "x64") return "darwin-x64";
  if (os === "linux" && arch === "x64") return "linux-x64";
  if (os === "linux" && arch === "arm64") return "linux-arm64";
  if (os === "win32" && arch === "x64") return "win-x64";
  if (os === "win32" && arch === "arm64") return "win-arm64";
  throw new Error(`Unsupported desktop runtime platform: ${os}-${arch}`);
}

const runtime = nodeRuntimePlatform();
const localTauriConfig = JSON.stringify({ bundle: { createUpdaterArtifacts: false } });
const tauriConfig = JSON.parse(readFileSync(join(web, "src-tauri", "tauri.conf.json"), "utf8"));

function localArtifactArch() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64";
  if (process.platform === "darwin" && process.arch === "x64") return "x64";
  return process.arch;
}

function createLocalMacDownloadArtifact() {
  if (process.platform !== "darwin") return;

  const productName = tauriConfig.productName ?? "DebridStreamer";
  const version = tauriConfig.version ?? "0.0.0";
  const bundleDir = join(web, "src-tauri", "target", "release", "bundle", "macos");
  const appName = `${productName}.app`;
  const appPath = join(bundleDir, appName);
  const zipPath = join(bundleDir, `${productName}_${version}_${localArtifactArch()}.app.zip`);

  if (!existsSync(appPath)) {
    throw new Error(`Expected app bundle missing: ${appPath}`);
  }

  rmSync(zipPath, { force: true });
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appName, zipPath], { cwd: bundleDir });
  console.log(`Created local macOS download artifact: ${zipPath}`);
}

run("npm", ["run", "build"], { cwd: server });
run("npm", ["run", "build"], { cwd: web });
run(process.execPath, ["scripts/prepare_tauri_server_resources.mjs"]);
run(process.execPath, ["scripts/download_tauri_node_runtime.mjs", runtime], {
  env: { NODE_RUNTIME_VERSION: process.env.NODE_RUNTIME_VERSION ?? "24.17.0" },
});
rmSync(join(web, "src-tauri", "target", "release", "bundle"), { recursive: true, force: true });
run("npm", [
  "run",
  "tauri",
  "--",
  "build",
  "--no-sign",
  ...(process.platform === "darwin" ? ["--bundles", "app"] : []),
  "--config",
  localTauriConfig,
], { cwd: web });
createLocalMacDownloadArtifact();
run(process.execPath, ["scripts/smoke_tauri_server_bundle.mjs"]);
