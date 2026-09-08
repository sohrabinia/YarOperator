import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperationalStateStore } from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("OperationalStateStore Durable Operational Memory", () => {
  const dbFile = join(tmpdir(), "test_operational_memory.db");

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

  it("should create, read, update, and delete operational state records", () => {
    const store = new OperationalStateStore(dbFile);
    store.set("wf_1", { status: "RUNNING", step: "init" });

    const record = store.get("wf_1");
    expect(record).not.toBeNull();
    expect(record?.value.status).toBe("RUNNING");

    store.set("wf_1", { status: "COMPLETED", step: "init" });
    const updated = store.get("wf_1");
    expect(updated?.value.status).toBe("COMPLETED");

    store.delete("wf_1");
    expect(store.get("wf_1")).toBeNull();
    store.close();
  });

  it("should persist state across process/store restarts", () => {
    let store1 = new OperationalStateStore(dbFile);
    store1.set("restart_test", { progress: 50 });
    store1.close();

    let store2 = new OperationalStateStore(dbFile);
    const retrieved = store2.get("restart_test");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.value.progress).toBe(50);
    store2.close();
  });

  it("should block persisting sensitive credentials or session data", () => {
    const store = new OperationalStateStore(dbFile);
    expect(() =>
      store.set("leak_attempt", { token: "SECRET_BEARER_TOKEN_123" }),
    ).toThrow(
      "Refusing to persist operational state containing protected secrets",
    );
    store.close();
  });
});
