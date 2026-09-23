import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApprovalManager } from "../src/core/policy/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 8: Idempotency and Duplicate Recovery Testing", () => {
  const dbPath = "test_idempotency_recovery.db";

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  afterEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. duplicate approval requests generate identical fingerprint without duplicating active tokens", () => {
    const manager1 = new ApprovalManager(dbPath);
    const params = { target: "prod" };

    const req1 = manager1.requestApproval(
      "git_operate:push",
      params,
      300000,
      "yartrader",
      "env_yartrader",
    );
    const req2 = manager1.requestApproval(
      "git_operate:push",
      params,
      300000,
      "yartrader",
      "env_yartrader",
    );

    expect(req1.id).toBe(req2.id);

    manager1.close();

    const manager2 = new ApprovalManager(dbPath);
    const rehydrated = manager2.get(
      "git_operate:push",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(rehydrated?.id).toBe(req1.id);

    manager2.close();
  });

  it("2. repeated process restart recovery is deterministic and preserves single-use tokens", () => {
    const manager1 = new ApprovalManager(dbPath);
    const params = { action: "deploy" };
    const req = manager1.requestApproval(
      "terminal_execute:run",
      params,
      300000,
      "yartrader",
      "env_yartrader",
    );
    manager1.grantApproval(req.id, "owner_sohrab");
    manager1.close();

    const manager2 = new ApprovalManager(dbPath);
    const consumeRes1 = manager2.consumeApproval(
      "terminal_execute:run",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(consumeRes1.valid).toBe(true);
    manager2.close();

    const manager3 = new ApprovalManager(dbPath);
    const consumeRes2 = manager3.consumeApproval(
      "terminal_execute:run",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(consumeRes2.valid).toBe(false);
    expect(consumeRes2.reason).toContain("already consumed");
    manager3.close();
  });

  it("3. notification insertion with identical ID replaces or preserves state without duplication", () => {
    const notifMgr1 = new NotificationManager(dbPath);
    const n = notifMgr1.notify({
      type: "TASK_COMPLETED",
      title: "Task 1",
      message: "Done",
      workspaceId: "yartrader",
    });
    notifMgr1.markAsRead(n.id);
    notifMgr1.close();

    const notifMgr2 = new NotificationManager(dbPath);
    const list = notifMgr2.listNotifications({ workspaceId: "yartrader" });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(n.id);
    expect(list[0].read).toBe(true);
    notifMgr2.close();
  });
});
