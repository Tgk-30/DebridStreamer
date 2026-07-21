#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE",
];

function requiredValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid control character in environment variable: ${name}`);
  }
  return value;
}

export function windowsSigningConfig(env = process.env) {
  const values = Object.fromEntries(
    REQUIRED.map((name) => [name, requiredValue(env, name)]),
  );
  const endpoint = new URL(values.AZURE_ARTIFACT_SIGNING_ENDPOINT);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    endpoint.pathname !== "/" ||
    !/^[a-z0-9-]+\.codesigning\.azure\.net$/iu.test(endpoint.hostname)
  ) {
    throw new Error("Azure Artifact Signing endpoint is not an approved HTTPS origin");
  }

  return {
    bundle: {
      windows: {
        signCommand: {
          cmd: "artifact-signing-cli",
          args: [
            "-e",
            endpoint.origin,
            "-a",
            values.AZURE_ARTIFACT_SIGNING_ACCOUNT,
            "-c",
            values.AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE,
            "-d",
            "YAWF Stream",
            "%1",
          ],
        },
      },
    },
  };
}

export async function writeWindowsSigningConfig(outputPath, env = process.env) {
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new Error("Usage: generate_windows_signing_config.mjs <output-path>");
  }
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify(windowsSigningConfig(env), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return destination;
}

async function main() {
  const destination = await writeWindowsSigningConfig(process.argv[2]);
  console.log(`Windows signing config written to ${destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
