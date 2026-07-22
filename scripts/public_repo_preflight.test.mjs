import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function createFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "yawf-public-preflight-"));
  await mkdir(join(cwd, "scripts"), { recursive: true });
  await Promise.all([
    copyFile(join(root, ".gitignore"), join(cwd, ".gitignore")),
    copyFile(join(root, ".dockerignore"), join(cwd, ".dockerignore")),
    copyFile(
      join(root, "scripts/public_repo_preflight.mjs"),
      join(cwd, "scripts/public_repo_preflight.mjs"),
    ),
    writeFile(join(cwd, "README.md"), "# Public fixture\n"),
  ]);
  git(cwd, ["init", "--quiet"]);
  git(cwd, ["config", "user.name", "Public Preflight Test"]);
  git(cwd, ["config", "user.email", "public-preflight@example.invalid"]);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "--quiet", "-m", "Initial fixture"]);
  return cwd;
}

function runPreflight(cwd) {
  return spawnSync(process.execPath, ["scripts/public_repo_preflight.mjs"], {
    cwd,
    encoding: "utf8",
  });
}

async function withFixture(run) {
  const cwd = await createFixture();
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("accepts a clean public repository", async () => {
  await withFixture(async (cwd) => {
    const result = runPreflight(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Public repo preflight passed/);
  });
});

test("rejects a tracked local planning artifact", async () => {
  await withFixture(async (cwd) => {
    await writeFile(join(cwd, "TARGET.md"), "Local release target\n");
    git(cwd, ["add", "--force", "TARGET.md"]);

    const result = runPreflight(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Tracked local planning or handoff artifact: TARGET\.md/);
  });
});

test("rejects credential material even when it is force-added", async () => {
  await withFixture(async (cwd) => {
    await writeFile(join(cwd, "release.pem"), "not a real private key\n");
    git(cwd, ["add", "--force", "release.pem"]);

    const result = runPreflight(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Tracked credential or signing material: release\.pem/);
  });
});

test("rejects provider-shaped tokens without storing one in this repository", async () => {
  await withFixture(async (cwd) => {
    const providerShapedToken = ["ghp", "_", "A".repeat(36)].join("");
    await writeFile(join(cwd, "local-secret.txt"), `${providerShapedToken}\n`);

    const result = runPreflight(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Possible GitHub token in unignored untracked file: local-secret\.txt/);
    assert.equal(result.stderr.includes(providerShapedToken), false);
  });
});

test("rejects an assistant instruction file removed from the current tree", async () => {
  await withFixture(async (cwd) => {
    await writeFile(join(cwd, "AI-WORKFLOW.md"), "Local-only instructions\n");
    git(cwd, ["add", "--force", "AI-WORKFLOW.md"]);
    git(cwd, ["commit", "--quiet", "-m", "Add local instructions"]);
    git(cwd, ["rm", "--quiet", "AI-WORKFLOW.md"]);
    git(cwd, ["commit", "--quiet", "-m", "Remove local instructions"]);

    const result = runPreflight(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Historical assistant instruction file: AI-WORKFLOW\.md/);
  });
});
