import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/db.js";

describe("AppDatabase", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("uses NORMAL synchronous mode for WAL databases", () => {
    const db = new AppDatabase(temporaryDatabasePath(tempDirs));
    try {
      expect((db.sqlite.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(1);
    } finally {
      db.close();
    }
  });

  it("removes expired audit records while retaining recent records", () => {
    const db = new AppDatabase(temporaryDatabasePath(tempDirs));
    try {
      const insert = db.sqlite.prepare(
        `INSERT INTO audit_log
         (id, actor_user_id, actor_profile_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?, NULL, NULL, 'test', NULL, NULL, NULL, ?)`,
      );
      insert.run("old", "2000-01-01T00:00:00.000Z");
      insert.run("recent", new Date().toISOString());

      db.pruneAuditLog();

      expect(
        (db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE id = 'old'").get() as {
          count: number;
        }).count,
      ).toBe(0);
      expect(
        (db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE id = 'recent'").get() as {
          count: number;
        }).count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});

function temporaryDatabasePath(tempDirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "debridstreamer-db-test-"));
  tempDirs.push(dir);
  return join(dir, "database.sqlite");
}
