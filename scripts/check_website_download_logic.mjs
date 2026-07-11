#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "website", "app.js"), "utf8");

const sandbox = {
  Intl,
  URLSearchParams,
  console,
  fetch: async () => {
    throw new Error("network disabled in website logic check");
  },
  navigator: {
    maxTouchPoints: 0,
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
  },
  window: {
    __DEBRIDSTREAMER_WEBSITE_TEST__: true,
    matchMedia: () => ({ matches: false }),
    setTimeout,
  },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      append() {},
      setAttribute() {},
      classList: { toggle() {} },
    }),
    createTextNode: (text) => ({ text }),
  },
  IntersectionObserver: class {
    observe() {}
  },
};
sandbox.window.navigator = sandbox.navigator;
sandbox.window.document = sandbox.document;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "website/app.js" });

const site = sandbox.window.DebridStreamerWebsite;
const failures = [];

function check(name, condition) {
  if (!condition) failures.push(name);
}

function asset(name, browser_download_url = name) {
  return { name, size: 10_000_000, browser_download_url };
}

check(
  "narrow desktop-class macOS still resolves to mac",
  site.detectPlatform({
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    maxTouchPoints: 0,
  }) === "mac",
);
check(
  "iPadOS desktop UA with touch resolves to mobile",
  site.detectPlatform({
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Mobile/15E148",
    maxTouchPoints: 5,
  }) === "mobile",
);
check(
  "Windows resolves to windows",
  site.detectPlatform({
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    maxTouchPoints: 0,
  }) === "windows",
);
check(
  "Linux resolves to linux",
  site.detectPlatform({
    platform: "Linux x86_64",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    maxTouchPoints: 0,
  }) === "linux",
);

const release = {
  assets: [
    asset("latest.json", "latest"),
    asset("DebridStreamer_0.1.0_aarch64.dmg.sig", "sig"),
    asset("DebridStreamer_0.1.0_aarch64.app.zip", "appzip"),
    asset("DebridStreamer_0.1.0_aarch64.dmg", "dmg"),
    asset("DebridStreamer_0.1.0_x64.dmg", "intel-dmg"),
    asset("DebridStreamer_0.1.0_x64-setup.exe", "exe"),
    asset("DebridStreamer_0.1.0_x64_en-US.msi", "msi"),
    asset("DebridStreamer_0.1.0_amd64.AppImage", "appimage"),
    asset("DebridStreamer_0.1.0_amd64.deb", "deb"),
    asset("DebridStreamer_0.1.0_amd64.rpm", "rpm"),
    asset("DebridStreamer_0.1.0_amd64.tar.gz", "linux-tar"),
  ],
};

check("mac best asset prefers dmg", site.bestAsset(release, "mac")?.browser_download_url === "dmg");
check(
  "mac Apple Silicon asset is selected explicitly",
  site.bestMacAsset(release, "arm64")?.browser_download_url === "dmg",
);
check(
  "mac Intel asset is selected explicitly",
  site.bestMacAsset(release, "x64")?.browser_download_url === "intel-dmg",
);
check(
  "Apple Silicon architecture is recognized",
  site.macArchitecture(asset("DebridStreamer_0.1.0_aarch64.dmg")) === "arm64",
);
check(
  "Intel architecture is recognized",
  site.macArchitecture(asset("DebridStreamer_0.1.0_x64.dmg")) === "x64",
);
check("windows best asset prefers msi", site.bestAsset(release, "windows")?.browser_download_url === "msi");
check("linux best asset prefers AppImage", site.bestAsset(release, "linux")?.browser_download_url === "appimage");
check(
  "mac falls back to pkg when no dmg exists",
  site.bestAsset(
    {
      assets: [
        asset("DebridStreamer_0.1.0_aarch64.app.tar.gz", "app-tar"),
        asset("DebridStreamer_0.1.0_aarch64.app.zip", "appzip"),
        asset("DebridStreamer_0.1.0_aarch64.pkg", "pkg"),
      ],
    },
    "mac",
  )?.browser_download_url === "pkg",
);
check(
  "mac falls back to app zip when no dmg or pkg exists",
  site.bestAsset(
    {
      assets: [
        asset("DebridStreamer_0.1.0_aarch64.app.tar.gz", "app-tar"),
        asset("DebridStreamer_0.1.0_aarch64.app.zip", "appzip"),
      ],
    },
    "mac",
  )?.browser_download_url === "appzip",
);
check(
  "mac falls back to app tar archive when app zip does not exist",
  site.bestAsset(
    {
      assets: [asset("DebridStreamer_0.1.0_aarch64.app.tar.gz", "app-tar")],
    },
    "mac",
  )?.browser_download_url === "app-tar",
);
check(
  "windows falls back to exe when no msi exists",
  site.bestAsset(
    {
      assets: [asset("DebridStreamer_0.1.0_x64-setup.exe", "exe")],
    },
    "windows",
  )?.browser_download_url === "exe",
);
check(
  "linux falls back to deb when no AppImage exists",
  site.bestAsset(
    {
      assets: [
        asset("DebridStreamer_0.1.0_amd64.rpm", "rpm"),
        asset("DebridStreamer_0.1.0_amd64.deb", "deb"),
      ],
    },
    "linux",
  )?.browser_download_url === "deb",
);
check(
  "linux falls back to rpm when no AppImage or deb exists",
  site.bestAsset(
    {
      assets: [
        asset("DebridStreamer_0.1.0_amd64.tar.gz", "linux-tar"),
        asset("DebridStreamer_0.1.0_amd64.rpm", "rpm"),
      ],
    },
    "linux",
  )?.browser_download_url === "rpm",
);
check(
  "linux falls back to tar archive when no package exists",
  site.bestAsset(
    {
      assets: [asset("DebridStreamer_0.1.0_amd64.tar.gz", "linux-tar")],
    },
    "linux",
  )?.browser_download_url === "linux-tar",
);
check(
  "mac app tar archive is not listed as a linux download",
  site.platformAssets(
    {
      assets: [asset("DebridStreamer_0.1.0_aarch64.app.tar.gz", "app-tar")],
    },
    "linux",
  ).length === 0,
);
check(
  "linux asset list preserves priority order",
  site.platformAssets(release, "linux").map((entry) => entry.browser_download_url).join(",") ===
    "appimage,deb,rpm,linux-tar",
);
check(
  "windows asset list preserves priority order",
  site.platformAssets(release, "windows").map((entry) => entry.browser_download_url).join(",") === "msi,exe",
);
check("installer filter ignores signatures", site.isInstallerAsset({ name: "file.dmg.sig" }) === false);
check("installer filter ignores latest.json", site.isInstallerAsset({ name: "latest.json" }) === false);
check("installer filter ignores blockmap sidecars", site.isInstallerAsset({ name: "file.exe.blockmap" }) === false);
check("installer filter ignores sha256 sidecars", site.isInstallerAsset({ name: "file.msi.sha256" }) === false);
check("installer filter ignores sha512 sidecars", site.isInstallerAsset({ name: "file.AppImage.sha512" }) === false);

if (failures.length > 0) {
  console.error("Website download logic check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Website download logic check passed.");
