import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./check_commit_privacy.mjs", import.meta.url).pathname;

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

async function createFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "yawf-commit-privacy-"));
  git(cwd, ["init", "--quiet", "--initial-branch=main"]);
  git(cwd, ["config", "user.name", "Privacy Test"]);
  git(cwd, ["config", "user.email", "privacy-test@users.noreply.github.com"]);
  await writeFile(join(cwd, "fixture.txt"), "initial\n");
  git(cwd, ["add", "fixture.txt"]);
  git(cwd, ["commit", "--quiet", "-m", "Initial fixture"]);
  return { cwd, initial: git(cwd, ["rev-parse", "HEAD"]) };
}

async function commit(cwd, message, email) {
  await writeFile(join(cwd, "fixture.txt"), `${Date.now()}-${Math.random()}\n`, { flag: "a" });
  git(cwd, ["add", "fixture.txt"]);
  const args = email
    ? ["-c", `user.email=${email}`, "commit", "--quiet", "-m", message]
    : ["commit", "--quiet", "-m", message];
  git(cwd, args);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function runGate(cwd, base, head = "HEAD") {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      COMMIT_PRIVACY_BASE: base,
      COMMIT_PRIVACY_HEAD: head,
    },
  });
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.cwd, { recursive: true, force: true });
  }
}

test("accepts clean commits with a GitHub no-reply identity", async () => {
  await withFixture(async ({ cwd, initial }) => {
    await commit(cwd, "Improve public repository checks");
    const result = runGate(cwd, initial);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Commit privacy gate passed/);
  });
});

test("rejects local-machine email identities", async () => {
  await withFixture(async ({ cwd, initial }) => {
    await commit(cwd, "Update tests", "developer@workstation.local");
    const result = runGate(cwd, initial);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /email ends in \.local/);
    assert.equal(result.stderr.includes("developer@workstation.local"), false);
  });
});

test("rejects generated attribution and automation trailers", async () => {
  await withFixture(async ({ cwd, initial }) => {
    const message = [
      "Update checks",
      "",
      ["Generated", " with build helper"].join(""),
      "",
      "Co-Authored-By: Build Helper <noreply@example.invalid>",
    ].join("\n");
    await commit(cwd, message);
    const result = runGate(cwd, initial);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /generated-attribution footer/);
    assert.match(result.stderr, /automation co-author trailer/);
  });
});

test("rejects local paths and internal workflow descriptions", async () => {
  await withFixture(async ({ cwd, initial }) => {
    await commit(cwd, "Record multi-agent audit from /Users/example/project/");
    const result = runGate(cwd, initial);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /developer-local filesystem path/);
    assert.match(result.stderr, /internal automation workflow/);
  });
});

test("does not re-evaluate legacy commits before the selected base", async () => {
  await withFixture(async ({ cwd }) => {
    await commit(cwd, "Legacy generated record", "developer@workstation.local");
    const base = git(cwd, ["rev-parse", "HEAD"]);
    await commit(cwd, "Clean follow-up");
    const result = runGate(cwd, base);
    assert.equal(result.status, 0, result.stderr);
  });
});
