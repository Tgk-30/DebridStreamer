import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  windowsSigningConfig,
  writeWindowsSigningConfig,
} from "./generate_windows_signing_config.mjs";

const VALID_ENV = {
  AZURE_ARTIFACT_SIGNING_ENDPOINT: "https://wus2.codesigning.azure.net",
  AZURE_ARTIFACT_SIGNING_ACCOUNT: "yawf-signing",
  AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE: "public-release",
  AZURE_CLIENT_ID: "client-id-must-not-be-written",
  AZURE_CLIENT_SECRET: "client-secret-must-not-be-written",
  AZURE_TENANT_ID: "tenant-id-must-not-be-written",
};

test("generates the exact Tauri custom signing command without client credentials", () => {
  const config = windowsSigningConfig(VALID_ENV);
  assert.deepEqual(config.bundle.windows.signCommand, {
    cmd: "artifact-signing-cli",
    args: [
      "-e",
      "https://wus2.codesigning.azure.net",
      "-a",
      "yawf-signing",
      "-c",
      "public-release",
      "-d",
      "YAWF Stream",
      "%1",
    ],
  });
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(VALID_ENV.AZURE_CLIENT_ID), false);
  assert.equal(serialized.includes(VALID_ENV.AZURE_CLIENT_SECRET), false);
  assert.equal(serialized.includes(VALID_ENV.AZURE_TENANT_ID), false);
});

test("writes a parseable config file", async () => {
  const output = join(tmpdir(), `yawf-signing-${process.pid}-${Date.now()}.json`);
  await writeWindowsSigningConfig(output, VALID_ENV);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), windowsSigningConfig(VALID_ENV));
});

test("fails closed when a required signing value is absent", () => {
  assert.throws(
    () =>
      windowsSigningConfig({
        ...VALID_ENV,
        AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE: " ",
      }),
    /AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE/,
  );
});

for (const endpoint of [
  "http://wus2.codesigning.azure.net",
  "https://codesigning.azure.net.evil.example",
  "https://wus2.codesigning.azure.net/path",
  "https://wus2.codesigning.azure.net?query=1",
]) {
  test(`rejects unapproved signing endpoint ${endpoint}`, () => {
    assert.throws(
      () =>
        windowsSigningConfig({
          ...VALID_ENV,
          AZURE_ARTIFACT_SIGNING_ENDPOINT: endpoint,
        }),
      /approved HTTPS origin/,
    );
  });
}
