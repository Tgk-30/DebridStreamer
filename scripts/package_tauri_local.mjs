#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
const tauriConfig = JSON.parse(readFileSync(join(web, "src-tauri", "tauri.conf.json"), "utf8"));

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function filesBelow(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function prepareLocalMacMpv() {
  if (process.platform !== "darwin") return null;

  const tauriDir = join(web, "src-tauri");
  const frameworksDir = join(tauriDir, "Frameworks");
  const mpvPrefix = commandOutput("brew", ["--prefix", "mpv"]);
  const libmpv = join(mpvPrefix, "lib", "libmpv.2.dylib");
  if (!existsSync(libmpv)) {
    throw new Error(`Homebrew libmpv is missing: ${libmpv}. Run \`brew install mpv\`.`);
  }

  rmSync(frameworksDir, { recursive: true, force: true });
  run(join(tauriDir, "scripts", "bundle-mpv-deps.sh"), [libmpv, frameworksDir]);
  const frameworks = filesBelow(frameworksDir)
    .filter((path) => path.endsWith(".dylib"))
    .map((path) => relative(tauriDir, path).split("\\").join("/"));
  if (!frameworks.some((path) => /libmpv(?:\.\d+)*\.dylib$/.test(path))) {
    throw new Error("The local macOS player bundle did not produce libmpv.");
  }
  return { frameworksDir, frameworks };
}

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

  const frameworksDir = join(appPath, "Contents", "Frameworks");
  const bundledFrameworks = existsSync(frameworksDir)
    ? filesBelow(frameworksDir).filter((path) => path.endsWith(".dylib"))
    : [];
  if (!bundledFrameworks.some((path) => /libmpv(?:\.\d+)*\.dylib$/.test(path))) {
    throw new Error(`Packaged app is missing bundled libmpv: ${frameworksDir}`);
  }
  const executables = readdirSync(join(appPath, "Contents", "MacOS"), {
    withFileTypes: true,
  }).filter((entry) => entry.isFile());
  if (executables.length !== 1) {
    throw new Error(`Expected one app executable, found ${executables.length}.`);
  }
  const nativeFiles = [
    join(appPath, "Contents", "MacOS", executables[0].name),
    ...bundledFrameworks,
  ];
  const buildMachinePrefixes = ["/opt/homebrew/", "/usr/local/"];
  for (const nativeFile of nativeFiles) {
    const dependencies = commandOutput("otool", ["-L", nativeFile]);
    if (buildMachinePrefixes.some((prefix) => dependencies.includes(prefix))) {
      throw new Error(`Packaged native dependency uses a build-machine path: ${nativeFile}`);
    }
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
run(process.execPath, ["scripts/download_ffmpeg.mjs", runtime]);
const localMacMpv = prepareLocalMacMpv();
const localTauriConfig = {
  bundle: {
    createUpdaterArtifacts: false,
    ...(localMacMpv == null
      ? {}
      : { macOS: { frameworks: localMacMpv.frameworks } }),
  },
};
rmSync(join(web, "src-tauri", "target", "release", "bundle"), { recursive: true, force: true });
run("npm", [
  "run",
  "tauri",
  "--",
  "build",
  "--no-sign",
  ...(process.platform === "darwin" ? ["--bundles", "app"] : []),
  "--config",
  JSON.stringify(localTauriConfig),
], {
  cwd: web,
  env: localMacMpv == null ? {} : { MPV_LIB_DIR: localMacMpv.frameworksDir },
});
createLocalMacDownloadArtifact();
run(process.execPath, ["scripts/smoke_tauri_server_bundle.mjs"]);
