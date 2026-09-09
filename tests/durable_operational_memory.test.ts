import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DurableOperationalMemory,
  OperationalMemoryError,
  OperationalStateStore,
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("Phase 8.1 — Durable Operational Memory", () => {
  const dbFile = join(tmpdir(), "test_phase_8_1_operational_memory.db");

  beforeEach(() => {
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  afterEach(() => {
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  it("should create, read, update, list, and delete operational memory state entries", () => {
    const memory = new DurableOperationalMemory(dbFile);

    memory.saveState("op:wf_1", { status: "RUNNING", stepId: "step_1" });
    expect(memory.hasState("op:wf_1")).toBe(true);

    const entry = memory.getState("op:wf_1");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("op:wf_1");
    expect(entry?.value).toEqual({ status: "RUNNING", stepId: "step_1" });
    expect(entry?.createdAt).toBeDefined();

    // Update
    memory.saveState("op:wf_1", { status: "COMPLETED", stepId: "step_1" });
    const updatedEntry = memory.getState("op:wf_1");
    expect(updatedEntry?.value.status).toBe("COMPLETED");

    // List
    memory.saveState("op:wf_2", { status: "PENDING" });
    const keys = memory.listKeys("op:");
    expect(keys).toEqual(["op:wf_1", "op:wf_2"]);

    // Delete
    const deleted = memory.deleteState("op:wf_1");
    expect(deleted).toBe(true);
    expect(memory.hasState("op:wf_1")).toBe(false);

    memory.close();
  });

  it("should prove durability across owner disposal and process recreation", () => {
    let memory1 = new DurableOperationalMemory(dbFile);
    memory1.saveState("execution:ctx_999", {
      taskId: "task_123",
      retryCount: 0,
      metadata: { env: "production" },
    });
    memory1.close();

    // Recreate owner using same backing database file
    let memory2 = new DurableOperationalMemory(dbFile);
    const restored = memory2.getState<{ taskId: string; retryCount: number }>(
      "execution:ctx_999",
    );

    expect(restored).not.toBeNull();
    expect(restored?.value.taskId).toBe("task_123");
    expect(restored?.value.retryCount).toBe(0);
    memory2.close();
  });

  it("should return null for non-existent key requests", () => {
    const memory = new DurableOperationalMemory(dbFile);
    const result = memory.getState("non_existent_key");
    expect(result).toBeNull();
    memory.close();
  });

  it("should reject invalid key or value inputs with structured OperationalMemoryError", () => {
    const memory = new DurableOperationalMemory(dbFile);

    expect(() => memory.saveState("", { data: 1 })).toThrow(
      OperationalMemoryError,
    );
    expect(() => memory.saveState("   ", { data: 1 })).toThrow(
      "Operational state key must be a non-empty string.",
    );
    expect(() =>
      memory.saveState("valid_key", "invalid_primitive_value" as any),
    ).toThrow("Operational state value must be a valid non-null object.");

    memory.close();
  });

  it("should refuse persisting sensitive credentials or session data", () => {
    const memory = new DurableOperationalMemory(dbFile);

    expect(() =>
      memory.saveState("leak:key", { sessionToken: "BEARER_TOKEN_ABC123" }),
    ).toThrow(
      "Refusing to persist operational state containing protected secrets",
    );

    memory.close();
  });

  it("should handle corrupt persisted representation safely without process crash", () => {
    const rawStore = new OperationalStateStore(dbFile);
    rawStore.saveRaw
      ? rawStore.saveRaw("corrupt_key", "INVALID_NON_JSON")
      : null;

    // Direct corrupt injection into DB table to simulate storage corruption
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbFile);
    db.prepare(
      "INSERT OR REPLACE INTO operational_state (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(
      "corrupt_key",
      "{malformed_json_syntax",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.close();

    const memory = new DurableOperationalMemory(dbFile);
    expect(() => memory.getState("corrupt_key")).toThrow(
      OperationalMemoryError,
    );
    expect(() => memory.getState("corrupt_key")).toThrow(
      "Corrupt operational state JSON",
    );

    memory.close();
  });

  it("should maintain key isolation and clear state when requested", () => {
    const memory = new DurableOperationalMemory(dbFile);

    memory.saveState("ns1:k1", { val: 1 });
    memory.saveState("ns2:k2", { val: 2 });

    expect(memory.listKeys("ns1:")).toEqual(["ns1:k1"]);
    expect(memory.listKeys("ns2:")).toEqual(["ns2:k2"]);

    memory.clearState();
    expect(memory.listKeys()).toEqual([]);

    memory.close();
  });
});
