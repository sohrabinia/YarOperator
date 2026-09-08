import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname } from "path";

const require = createRequire(import.meta.url);

export interface OperationalStateRecord {
  key: string;
  value: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class OperationalStateStore {
  private db: any;

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      const parentDir = dirname(dbPath);
      if (parentDir && parentDir !== ".") {
        mkdirSync(parentDir, { recursive: true });
      }
    }
    const { DatabaseSync } = require("node:sqlite");
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operational_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  set(key: string, value: Record<string, unknown>): void {
    const jsonString = JSON.stringify(value);
    if (
      /(PASSWORD|SECRET|SESSION_TOKEN|COOKIE|BEARER_TOKEN)/i.test(jsonString)
    ) {
      throw new Error(
        `Security Exception: Refusing to persist operational state containing protected secrets/session data.`,
      );
    }

    const now = new Date().toISOString();
    const existing = this.get(key);

    const createdAt = existing ? existing.createdAt : now;
    const updatedAt = now;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO operational_state (key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(key, jsonString, createdAt, updatedAt);
  }

  get(key: string): OperationalStateRecord | null {
    const stmt = this.db.prepare(`
      SELECT key, value, created_at, updated_at FROM operational_state WHERE key = ?
    `);

    const row = stmt.get(key) as
      | { key: string; value: string; created_at: string; updated_at: string }
      | undefined;

    if (!row) return null;

    return {
      key: row.key,
      value: JSON.parse(row.value),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  delete(key: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM operational_state WHERE key = ?`);
    const result = stmt.run(key);
    return typeof result.changes === "bigint"
      ? result.changes > 0n
      : (result.changes ?? 0) > 0;
  }

  clear(): void {
    this.db.exec(`DELETE FROM operational_state;`);
  }

  close(): void {
    this.db.close();
  }
}
