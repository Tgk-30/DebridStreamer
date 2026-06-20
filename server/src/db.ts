import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
  MIGRATION_006,
  MIGRATION_007,
} from "./schema.js";

export class AppDatabase {
  readonly sqlite: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
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

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    let current =
      (this.sqlite
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get() as { version: number | null }).version ?? 0;

    if (current < 1) {
      this.sqlite.exec(MIGRATION_001);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(1, new Date().toISOString());
      current = 1;
    }

    if (current < 2) {
      this.sqlite.exec(MIGRATION_002);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(2, new Date().toISOString());
      current = 2;
    }

    if (current < 3) {
      this.sqlite.exec(MIGRATION_003);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(3, new Date().toISOString());
      current = 3;
    }

    if (current < 4) {
      this.sqlite.exec(MIGRATION_004);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(4, new Date().toISOString());
      current = 4;
    }

    if (current < 5) {
      this.sqlite.exec(MIGRATION_005);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(5, new Date().toISOString());
      current = 5;
    }

    if (current < 6) {
      this.sqlite.exec(MIGRATION_006);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(6, new Date().toISOString());
      current = 6;
    }

    if (current < 7) {
      this.sqlite.exec(MIGRATION_007);
      this.sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(7, new Date().toISOString());
    }
  }
}
