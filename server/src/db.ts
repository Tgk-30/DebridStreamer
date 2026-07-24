import { dirname } from "node:path";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema.js";

const AUDIT_LOG_RETENTION_DAYS = 90;
const AUDIT_LOG_MINIMUM_ROWS = 50_000;

export class AppDatabase {
  readonly sqlite: DatabaseSync;
  private readonly lockPath: string | null;
  private closed = false;

  constructor(path: string) {
    const existingDatabase =
      path !== ":memory:" && existsSync(path) && statSync(path).size > 0;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.lockPath = path === ":memory:" ? null : acquireDatabaseLock(path);
    let opened: DatabaseSync | null = null;
    try {
      opened = new DatabaseSync(path);
      this.sqlite = opened;
      this.sqlite.exec("PRAGMA foreign_keys = ON;");
      this.sqlite.exec("PRAGMA journal_mode = WAL;");
      // Standard WAL durability: only OS or power loss can lose the last resume tick.
      this.sqlite.exec("PRAGMA synchronous = NORMAL;");
      if (existingDatabase) {
        createPreUpgradeSnapshotIfNeeded(this.sqlite, path);
      }
      migrateDatabase(this.sqlite);
      this.pruneAuditLog();
    } catch (error) {
      try {
        opened?.close();
      } catch {
        // Preserve the migration/open error that triggered recovery cleanup.
      }
      if (this.lockPath != null) {
        try {
          releaseDatabaseLock(this.lockPath);
        } catch {
          // Preserve the migration/open error that triggered recovery cleanup.
        }
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.sqlite.close();
    } finally {
      if (this.lockPath != null) releaseDatabaseLock(this.lockPath);
    }
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

export function databaseLockPath(databasePath: string): string {
  return `${databasePath}.server.lock`;
}

export function isDatabaseServerRunning(databasePath: string): boolean {
  const lockPath = databaseLockPath(databasePath);
  if (!existsSync(lockPath)) return false;
  let pid: number;
  try {
    pid = Number(readFileSync(lockPath, "utf8").trim());
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    return true;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      rmSync(lockPath, { force: true });
      return false;
    }
    return true;
  }
}

function releaseDatabaseLock(lockPath: string): void {
  try {
    const ownerPid = Number(readFileSync(lockPath, "utf8").trim());
    if (ownerPid === process.pid) rmSync(lockPath, { force: true });
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
}

function acquireDatabaseLock(databasePath: string): string {
  const lockPath = databaseLockPath(databasePath);
  if (isDatabaseServerRunning(databasePath)) {
    throw new Error(`The YAWF Stream database is already open: ${databasePath}`);
  }
  let file: number;
  try {
    file = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    throw new Error(`Could not acquire the database lock: ${lockPath}`, {
      cause: error,
    });
  }
  try {
    writeFileSync(file, `${process.pid}\n`, "utf8");
  } finally {
    closeSync(file);
  }
  return lockPath;
}

function currentSchemaVersion(sqlite: DatabaseSync): number {
  const migrationTable = sqlite
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (migrationTable == null) return 0;
  const row = sqlite
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  return Number(row.version);
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function createPreUpgradeSnapshotIfNeeded(
  sqlite: DatabaseSync,
  databasePath: string,
  now = new Date(),
): string | null {
  const latestVersion = MIGRATIONS.at(-1)?.[0] ?? 0;
  const currentVersion = currentSchemaVersion(sqlite);
  if (currentVersion >= latestVersion) return null;

  const backupDir = `${dirname(databasePath)}/backups`;
  mkdirSync(backupDir, { recursive: true });
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputPath =
    `${backupDir}/pre-upgrade-v${currentVersion}-to-v${latestVersion}-${timestamp}.sqlite`;
  sqlite.exec(`VACUUM INTO ${sqlStringLiteral(outputPath)}`);
  chmodSync(outputPath, 0o600);
  return outputPath;
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
