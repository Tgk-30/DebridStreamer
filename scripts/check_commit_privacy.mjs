#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function resolveCommit(ref) {
  if (!ref || /^0+$/.test(ref)) return null;
  try {
    return git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

function fallbackBase(head) {
  const defaultBranch = process.env.GITHUB_EVENT_REPOSITORY_DEFAULT_BRANCH || "main";
  for (const candidate of [`origin/${defaultBranch}`, defaultBranch]) {
    const resolved = resolveCommit(candidate);
    if (!resolved) continue;
    return git(["merge-base", resolved, head]).trim();
  }
  const parent = resolveCommit(`${head}^`);
  if (parent) return parent;
  throw new Error("Could not resolve a base commit for the privacy check");
}

function commitRecords(base, head) {
  if (base === head) return [];
  const raw = git(["log", "--format=%H%x00%ae%x00%ce%x00%B%x1e", `${base}..${head}`]);
  return raw
    .split("\x1e")
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [sha, authorEmail, committerEmail, message] = record.split("\x00", 4);
      return {
        sha: sha.trim(),
        authorEmail: authorEmail.trim(),
        committerEmail: committerEmail.trim(),
        message,
      };
    });
}

const localPathPattern =
  /(?:^|[\s`"'(])(?:\/Users\/[^/\s]+\/|\/Volumes\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/m;
const generatedAttributionPattern = /(?:^|\n)\s*(?:🤖\s*)?Generated with\b/im;
const internalProcessPattern =
  /\b(?:multi-agent|subagent|model[- ]routing|agentic review|adversarial (?:workflow|audit)|in-house forensic)\b/i;
const coauthorPattern = /^Co-Authored-By:\s*.*<([^>]+)>\s*$/gim;

function violationsFor(record) {
  const violations = [];
  if (
    record.authorEmail.toLowerCase().endsWith(".local") ||
    record.committerEmail.toLowerCase().endsWith(".local")
  ) {
    violations.push("author or committer email ends in .local");
  }
  if (localPathPattern.test(record.message)) {
    violations.push("commit message contains a developer-local filesystem path");
  }
  if (generatedAttributionPattern.test(record.message)) {
    violations.push("commit message contains a generated-attribution footer");
  }
  if (internalProcessPattern.test(record.message)) {
    violations.push("commit message describes an internal automation workflow");
  }

  coauthorPattern.lastIndex = 0;
  let match;
  while ((match = coauthorPattern.exec(record.message)) !== null) {
    const email = match[1].toLowerCase();
    if (email.includes("noreply@") && !email.endsWith("@users.noreply.github.com")) {
      violations.push("commit message contains a non-GitHub automation co-author trailer");
      break;
    }
  }
  return violations;
}

const requestedHead = process.env.COMMIT_PRIVACY_HEAD || "HEAD";
const head = resolveCommit(requestedHead);
if (!head) {
  console.error("Commit privacy gate failed: head commit could not be resolved");
  process.exit(1);
}

const requestedBase = process.env.COMMIT_PRIVACY_BASE;
const base = resolveCommit(requestedBase) || fallbackBase(head);
const records = commitRecords(base, head);
const failures = records.flatMap((record) =>
  violationsFor(record).map((violation) => `${record.sha.slice(0, 12)}: ${violation}`),
);

if (failures.length > 0) {
  console.error("Commit privacy gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Commit privacy gate passed (${records.length} new commit(s), ${base.slice(0, 12)}..${head.slice(0, 12)}).`,
);
