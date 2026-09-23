import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IdentityStore } from "../src/core/identity/index.js";
import { ApprovalManager } from "../src/core/policy/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { createRequire } from "node:module";
import { unlinkSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

describe("Phase 7: Corruption / Fail-Closed Testing", () => {
  const dbPath = "test_persistence_corruption_failclosed.db";

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  afterEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. corrupt session in SQLite fails closed and never authenticates", () => {
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE user_identities (
        user_id TEXT PRIMARY KEY,
        primary_email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL,
        default_workspace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO sessions VALUES ('sess_corrupt_123', 'usr_unknown', 'owner_attacker', 12345, 100);
    `);
    rawDb.close();

    const identityStore = new IdentityStore(dbPath);
    const session = identityStore.getSession("sess_corrupt_123");
    expect(session).toBeNull();

    identityStore.close();
  });

  it("2. corrupt approval request in SQLite fails closed and throws persistence error", () => {
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE approvals (
        fingerprint TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        action TEXT,
        workspace_id TEXT,
        environment_id TEXT,
        owner_id TEXT,
        task_id TEXT,
        params_json TEXT,
        normalized_params_hash TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        approver TEXT
      );
      INSERT INTO approvals VALUES (
        'fp_corrupt_999', 'terminal_execute', 'run', 'ws_a', 'env_a', 'owner_a', 'task_1',
        '{invalid_json}', 'fp_corrupt_999', 1000, 2000, 'PENDING', NULL
      );
    `);
    rawDb.close();

    expect(() => new ApprovalManager(dbPath)).toThrow(
      "PERSISTENCE CORRUPTION FAILURE",
    );
  });

  it("3. corrupt notification metadata fails closed and throws persistence error", () => {
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        workspace_id TEXT,
        task_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL
      );
      INSERT INTO notifications VALUES (
        'notif_corrupt_1', 'TASK_FAILED', 'HIGH', 'Title', 'Msg',
        'yartrader', 'task_1', 'CORRUPTED_JSON_BLOB', 1000000, 0
      );
    `);
    rawDb.close();

    expect(() => new NotificationManager(dbPath)).toThrow(
      "PERSISTENCE CORRUPTION FAILURE",
    );
  });
});
