import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema.js";

const AUDIT_LOG_RETENTION_DAYS = 90;
const AUDIT_LOG_MINIMUM_ROWS = 50_000;

export class AppDatabase {
  readonly sqlite: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    // Standard WAL durability: only OS or power loss can lose the last resume tick.
    this.sqlite.exec("PRAGMA synchronous = NORMAL;");
    migrateDatabase(this.sqlite);
    this.pruneAuditLog();
  }

  close(): void {
    this.sqlite.close();
  }

  transaction<T>(work: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.sqlite.exec("COMMIT;");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  /** Retain recent security events and at least the newest 50,000 audit records. */
  pruneAuditLog(now = new Date()): void {
    const cutoff = new Date(
      now.getTime() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.sqlite
      .prepare(
        `DELETE FROM audit_log
         WHERE created_at < ?
           AND created_at < COALESCE(
             (SELECT created_at
              FROM audit_log
              ORDER BY created_at DESC
              LIMIT 1 OFFSET ?),
             ?
           )`,
      )
      .run(cutoff, AUDIT_LOG_MINIMUM_ROWS - 1, cutoff);
  }

}

/** Upgrade a database one version at a time. Each schema change and its
 * version marker share a transaction, so an interrupted or invalid migration
 * can never leave a half-upgraded database that fails on every later launch. */
export function migrateDatabase(sqlite: DatabaseSync): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const latestVersion = MIGRATIONS.at(-1)?.[0] ?? 0;
  const appliedRows = sqlite
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  const newestApplied = appliedRows.at(-1)?.version ?? 0;
  if (newestApplied > latestVersion) {
    throw new Error(
      `Database schema version ${newestApplied} is newer than supported version ${latestVersion}.`,
    );
  }

  for (const [version, sql] of MIGRATIONS) {
    if (applied.has(version)) continue;
    sqlite.exec("BEGIN IMMEDIATE;");
    try {
      sqlite.exec(sql);
      sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
      sqlite.exec("COMMIT;");
      applied.add(version);
    } catch (error) {
      sqlite.exec("ROLLBACK;");
      throw new Error(`Database migration ${version} failed.`, { cause: error });
    }
  }

  const foreignKeyViolation = sqlite.prepare("PRAGMA foreign_key_check").get();
  if (foreignKeyViolation != null) {
    throw new Error("Database migration completed with a foreign key violation.");
  }
}
