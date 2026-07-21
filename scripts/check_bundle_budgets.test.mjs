import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkBundleBudget, measureBundle } from "./check_bundle_budgets.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yawf-bundle-budget-"));
  const dist = join(root, "fixture", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<script src="/server-mode.js"></script><script type="module" src="/mounted/assets/entry.js"></script><link rel="stylesheet" href="/mounted/assets/index.css">',
  );
  writeFileSync(join(dist, "server-mode.js"), "server");
  writeFileSync(join(dist, "assets", "entry.js"), "entry");
  writeFileSync(join(dist, "assets", "index.css"), "style");
  writeFileSync(join(dist, "assets", "lazy.js"), "lazy-route");
  return { root, dist };
}

const generousBudget = {
  fixture: {
    label: "Fixture",
    initialRaw: 1_000,
    initialGzip: 1_000,
    initialRequests: 4,
    largestJsRaw: 1_000,
    largestJsGzip: 1_000,
  },
};

test("measures mounted assets, root scripts, and the largest lazy chunk", () => {
  const { root } = fixture();
  try {
    const metrics = measureBundle("fixture", { root });
    assert.deepEqual(metrics.initialFiles, ["assets/entry.js", "assets/index.css", "server-mode.js"]);
    assert.equal(metrics.initialRaw, 16);
    assert.equal(metrics.initialRequests, 3);
    assert.equal(metrics.largestRaw.name, "assets/lazy.js");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes a build within all configured limits", () => {
  const { root } = fixture();
  try {
    const lines = [];
    const metrics = checkBundleBudget("fixture", {
      root,
      budgets: generousBudget,
      log: (line) => lines.push(line),
    });
    assert.equal(metrics.initialRequests, 3);
    assert.equal(lines.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects initial payload and lazy-chunk regressions", () => {
  const { root } = fixture();
  try {
    assert.throws(
      () =>
        checkBundleBudget("fixture", {
          root,
          budgets: {
            fixture: {
              ...generousBudget.fixture,
              initialRaw: 10,
              largestJsRaw: 5,
            },
          },
          log: () => {},
        }),
      /initial raw assets[\s\S]*lazy\.js/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when an initial asset is missing", () => {
  const { root, dist } = fixture();
  try {
    writeFileSync(join(dist, "index.html"), '<script src="/assets/missing.js"></script>');
    assert.throws(() => measureBundle("fixture", { root }), /initial asset is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
