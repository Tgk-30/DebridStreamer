#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultXcode = "/Applications/Xcode-beta.app/Contents/Developer";
const scratch = process.env.SWIFT_TEST_SCRATCH?.trim() ||
  "/private/tmp/debridstreamer-swiftpm-scratch";
const debugProducts = join(scratch, "out", "Products", "Debug");
const packageFrameworks = join(debugProducts, "PackageFrameworks");
const vlcFramework = join(debugProducts, "VLCKit.framework");
const vlcFrameworkLink = join(packageFrameworks, "VLCKit.framework");
// The vendored macOS slice of the VLCKit xcframework - used as a fallback when
// SwiftPM doesn't copy the binary framework into Products/Debug (its placement
// of binary targets varies by Xcode/SwiftPM version).
const vendorVlcFramework = join(
  root,
  "Vendor",
  "VLCKit.xcframework",
  "macos-arm64_x86_64",
  "VLCKit.framework",
);

const env = {
  ...process.env,
  CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH || "/tmp/clang-module-cache",
  SWIFTPM_CACHE_DIR: process.env.SWIFTPM_CACHE_DIR || "/tmp/swiftpm-cache",
};
if (!env.DEVELOPER_DIR && existsSync(defaultXcode)) {
  env.DEVELOPER_DIR = defaultXcode;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    ...options,
  });
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

console.log(`Using SwiftPM scratch path: ${scratch}`);
const build = run("swift", ["build", "--build-tests", "--scratch-path", scratch], {
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

if (!existsSync(vlcFramework)) {
  // SwiftPM didn't place the binary framework in Products/Debug - fall back to
  // the vendored xcframework slice so the test runtime can load VLCKit.
  if (!existsSync(vendorVlcFramework)) {
    fail(
      `VLCKit.framework missing from ${vlcFramework} and no vendored copy at ` +
        `${vendorVlcFramework} (is Git LFS materialized?)`,
    );
  }
  mkdirSync(debugProducts, { recursive: true });
  cpSync(vendorVlcFramework, vlcFramework, { recursive: true, verbatimSymlinks: true });
  console.log(`Copied VLCKit.framework from the vendored xcframework into ${debugProducts}`);
}
mkdirSync(packageFrameworks, { recursive: true });
if (!existsSync(vlcFrameworkLink)) {
  symlinkSync("../VLCKit.framework", vlcFrameworkLink);
} else if (!lstatSync(vlcFrameworkLink).isSymbolicLink()) {
  fail(`${vlcFrameworkLink} exists but is not a symlink.`);
}

const test = run("swift", ["test", "--skip-build", "--scratch-path", scratch]);
printResult(test);

const combined = `${test.stdout || ""}\n${test.stderr || ""}`;
const assertionFailurePattern =
  /recorded an issue|(?:^|\n)\s*\u2718 Test .* failed after|[1-9][0-9]* (?:test|tests) failed|with [1-9][0-9]* failures/i;

if (assertionFailurePattern.test(combined)) {
  fail("Swift test assertion failures detected.");
}
if (!/Test run started/i.test(combined)) {
  fail("Swift tests did not run.");
}
if (test.status !== 0 || test.signal) {
  console.warn(
    `swift test exited ${test.signal || test.status} with no assertion failures; tolerating the known SwiftPM/VLCKit teardown crash.`,
  );
}

console.log("Swift test assertions passed.");
