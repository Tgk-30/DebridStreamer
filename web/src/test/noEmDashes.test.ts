// Durable guard for the project rule: no em dashes anywhere in the source
// (user-facing copy, docs, or comments). The house style uses a spaced hyphen
// " - " for punctuation and an en dash only for numeric ranges (e.g. "1-10").
// This test walks the whole src tree and fails with exact locations if an
// em dash (U+2014) or horizontal bar (U+2015) ever reappears, so a stray one
// from an editor autocorrect or a pasted snippet is caught in CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXT = /\.(ts|tsx|js|jsx|css|md|html|json)$/;
// U+2014 em dash, U+2015 horizontal bar. En dash (U+2013) is allowed for ranges.
const FORBIDDEN = /[—―]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (TEXT_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no em dashes in source", () => {
  it("has no U+2014 / U+2015 anywhere under src", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // Skip this guard itself (it names the forbidden code points on purpose).
      if (file.endsWith("noEmDashes.test.ts")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `Replace em dashes with " - " or a range en dash:\n${offenders.join("\n")}`).toEqual([]);
  });
});
