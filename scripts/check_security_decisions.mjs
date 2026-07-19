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
for (let id = 1; id <= 10; id += 1) {
  check(decisions.includes(`SEC-${String(id).padStart(3, "0")}`), `Security decision SEC-${String(id).padStart(3, "0")} is recorded`);
}

const capability = JSON.parse(read("web/src-tauri/capabilities/default.json"));
const permissions = capability.permissions ?? [];
const permissionIds = permissions.map((entry) =>
  typeof entry === "string" ? entry : entry.identifier,
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

const tauri = JSON.parse(read("web/src-tauri/tauri.conf.json"));
const csp = tauri.app?.security?.csp ?? "";
check(csp.includes("default-src 'self'"), "Desktop CSP defaults to self");
check(csp.includes("object-src 'none'"), "Desktop CSP blocks objects");
check(csp.includes("frame-ancestors 'none'"), "Desktop CSP blocks framing");
check(!csp.includes("'unsafe-eval'"), "Desktop CSP blocks eval");
check(tauri.bundle?.createUpdaterArtifacts === true, "Updater artifacts remain enabled");
check((tauri.plugins?.updater?.pubkey ?? "").length > 40, "Updater public key is configured");

const serverConfig = read("server/src/config.ts");
const serverCrypto = read("server/src/crypto.ts");
const serverApp = read("server/src/app.ts");
const database = read("server/src/db.ts");
const diagnostics = read("web/src/lib/diagnostics.ts");
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

if (failures.length > 0) {
  console.error(`\n${failures.length} security decision check(s) failed.`);
  process.exit(1);
}
console.log("\nSecurity decision checks passed.");
