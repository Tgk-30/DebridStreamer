#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(condition, message) {
  if (condition) console.log(`ok   ${message}`);
  else {
    failures.push(message);
    console.error(`fail ${message}`);
  }
}

const decisionsPath = "docs/SECURITY_DECISIONS.md";
check(existsSync(join(root, decisionsPath)), "Security decision log exists");
const decisions = read(decisionsPath);
for (let id = 1; id <= 11; id += 1) {
  check(decisions.includes(`SEC-${String(id).padStart(3, "0")}`), `Security decision SEC-${String(id).padStart(3, "0")} is recorded`);
}
check(
  /SEC-008[^\n]*NSIS[^\n]*config generator/.test(decisions),
  "Security decision SEC-008 covers NSIS and generated signing config",
);

const capability = JSON.parse(read("web/src-tauri/capabilities/default.json"));
const remoteCapability = JSON.parse(
  read("web/src-tauri/capabilities/remote.json"),
);
const permissions = capability.permissions ?? [];
const remotePermissions = remoteCapability.permissions ?? [];
const permissionIds = permissions.map((entry) =>
  typeof entry === "string" ? entry : entry.identifier,
);
const remotePermissionIds = remotePermissions.map((entry) =>
  typeof entry === "string" ? entry : entry.identifier,
);
const remoteUrls = remoteCapability.remote?.urls ?? [];
check(capability.remote == null, "Local desktop capability has no remote scope");
check(
  remoteCapability.local === false &&
    ["https://*:*", "http://*:*"].every((url) => remoteUrls.includes(url)),
  "Follow-mode HTTP and HTTPS origins on custom ports receive the desktop capability",
);
check(
  permissionIds.includes("desktop-commands") &&
    remotePermissionIds.includes("remote-desktop-commands"),
  "Local and follow-mode desktop commands have separate app ACL permissions",
);
const desktopPermission = read("web/src-tauri/permissions/desktop-commands.toml");
const remoteDesktopPermission = read(
  "web/src-tauri/permissions/remote-desktop-commands.toml",
);
const desktopCommandNames = new Set(
  [...desktopPermission.matchAll(/^\s*"([a-z][a-z0-9_]*)",?\s*$/gm)].map(
    (match) => match[1],
  ),
);
const remoteDesktopCommandNames = new Set(
  [
    ...remoteDesktopPermission.matchAll(
      /^\s*"([a-z][a-z0-9_]*)",?\s*$/gm,
    ),
  ].map((match) => match[1]),
);
const tauriLib = read("web/src-tauri/src/lib.rs");
const handlerBlock = tauriLib.match(
  /\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
)?.[1];
const registeredDesktopCommands = new Set(
  [
    ...(handlerBlock ?? "").matchAll(
      /^\s*(?:[a-z][a-z0-9_]*::)?([a-z][a-z0-9_]*),\s*$/gm,
    ),
  ].map((match) => match[1]),
);
check(handlerBlock != null, "Desktop invoke handler command list is readable");
check(
  registeredDesktopCommands.size > 0 &&
    [...registeredDesktopCommands].every((command) =>
      desktopCommandNames.has(command),
    ) &&
    [...desktopCommandNames].every((command) => registeredDesktopCommands.has(command)),
  "Desktop app ACL stays in sync with every registered command",
);
check(
  [
    "player_init",
    "player_command",
    "player_set_property",
    "player_get_property",
    "player_set_video_margin",
    "player_set_rect",
    "player_destroy",
  ].every((command) => remoteDesktopCommandNames.has(command)),
  "Built-in player commands are allowed for follow-mode playback",
);
check(
  !remoteDesktopCommandNames.has("player_load"),
  "Follow-mode pages cannot use the legacy unvalidated player loader",
);
check(
  !["keychain_get", "keychain_set", "keychain_delete"].some((command) =>
    remoteDesktopCommandNames.has(command),
  ),
  "Follow-mode pages cannot access desktop keychain commands",
);
check(!permissionIds.includes("opener:default"), "Desktop opener does not grant the default reveal permission");
check(!permissionIds.includes("process:default"), "Desktop process plugin does not grant exit permission");
check(permissionIds.includes("process:allow-restart"), "Desktop process plugin is limited to updater restart");
const opener = permissions.find(
  (entry) => typeof entry === "object" && entry.identifier === "opener:allow-open-url",
);
const openerUrls = (opener?.allow ?? []).map((entry) => entry.url);
check(
  ["https://*", "http://*", "ms-settings:appsfeatures"].every((url) => openerUrls.includes(url)),
  "Desktop external URL scope is explicit",
);
check(!permissionIds.some((id) => id.startsWith("shell:")), "Desktop webview has no shell permission");
check(!permissionIds.some((id) => id.startsWith("fs:")), "Desktop webview has no filesystem permission");
check(
  !remotePermissionIds.some((id) => id.startsWith("shell:") || id.startsWith("fs:")),
  "Follow-mode webview has no shell or filesystem permission",
);

const tauri = JSON.parse(read("web/src-tauri/tauri.conf.json"));
const csp = tauri.app?.security?.csp ?? "";
check(csp.includes("default-src 'self'"), "Desktop CSP defaults to self");
check(csp.includes("object-src 'none'"), "Desktop CSP blocks objects");
check(csp.includes("frame-ancestors 'none'"), "Desktop CSP blocks framing");
check(!csp.includes("'unsafe-eval'"), "Desktop CSP blocks eval");
check(tauri.bundle?.createUpdaterArtifacts === true, "Updater artifacts remain enabled");
check((tauri.plugins?.updater?.pubkey ?? "").length > 40, "Updater public key is configured");

const releaseWorkflow = read(".github/workflows/web-release.yml");
const cleanInstallWorkflow = read(".github/workflows/clean-install.yml");
const windowsSigningConfig = read("scripts/generate_windows_signing_config.mjs");
check(
  /artifact-signing-cli --version 0\.11\.0 --locked/.test(releaseWorkflow) &&
    /AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE/.test(releaseWorkflow) &&
    /codesigning\\\.azure\\\.net/.test(windowsSigningConfig) &&
    !/AZURE_CLIENT_SECRET/.test(windowsSigningConfig),
  "Windows release signing uses the pinned Azure Artifact Signing path",
);
check(
  /Windows \$env:INSTALLER_KIND installer Authenticode signature is not valid/.test(
    cleanInstallWorkflow,
  ) &&
    /Installed app Authenticode signature is not valid/.test(cleanInstallWorkflow) &&
    /kind: msi/.test(cleanInstallWorkflow) &&
    /kind: nsis/.test(cleanInstallWorkflow),
  "Windows clean installs require valid MSI, NSIS, and app signatures",
);

const serverConfig = read("server/src/config.ts");
const serverCrypto = read("server/src/crypto.ts");
const serverApp = read("server/src/app.ts");
const database = read("server/src/db.ts");
const diagnostics = read("web/src/lib/diagnostics.ts");
const nativePlayer = read("web/src-tauri/src/render_player/core.rs");
check(
  /allowRawStreamUrls:[\s\S]{0,160}process\.env\.NODE_ENV !== "production"/.test(serverConfig),
  "Production raw stream URL creation defaults off",
);
check(/createCipheriv\("aes-256-gcm"/.test(serverCrypto), "Server secrets use AES-256-GCM");
check(/writeFileSync\(path, generated, \{ mode: 0o600 \}\)/.test(serverConfig), "Generated server key uses mode 0600");
check(/cookieOptions\(config, true\)/.test(serverApp), "Session cookie is httpOnly");
check(/requireCsrf\(request\)/.test(serverApp), "Unsafe authenticated routes enforce CSRF");
check(/BEGIN IMMEDIATE/.test(database) && /ROLLBACK/.test(database), "Database migrations are transactional");
check(/newer than supported version/.test(database), "Newer database versions fail closed");
check(/redactDiagnosticText/.test(diagnostics) && /LONG_CREDENTIAL/.test(diagnostics), "Diagnostics redact credential-shaped values");
check(
  /createHmac\("sha256", config\.secretKey\)/.test(serverApp) &&
    /streamPlaybackTokenMatches/.test(serverApp),
  "Server playback bearer is stream-scoped and authenticated",
);
check(
  /_ => return Err\("command is not allowed"\.to_string\(\)\)/.test(nativePlayer) &&
    /_ => Err\("property is not allowed"\.to_string\(\)\)/.test(nativePlayer) &&
    /stream-lavf-o=max_redirects=0/.test(nativePlayer),
  "Native player bridge is allowlisted and keeps playback authorization file-local",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} security decision check(s) failed.`);
  process.exit(1);
}
console.log("\nSecurity decision checks passed.");
