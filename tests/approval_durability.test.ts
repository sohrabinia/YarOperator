import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApprovalManager } from "../src/core/policy/index.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 2: Approval Manager Durability", () => {
  const dbPath = "test_approval_durability.db";
  let manager: ApprovalManager;

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    manager = new ApprovalManager(dbPath);
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {}
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. create pending approval and survive restart", () => {
    const params = { branch: "main", force: true };
    const req = manager.requestApproval(
      "git_operate:push",
      params,
      300000,
      "yartrader",
      "env_yartrader",
      "git_operate:push",
      "owner_sohrab",
      "task_123",
    );

    expect(req.status).toBe("PENDING");

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const rehydrated = manager2.get(
      "git_operate:push",
      params,
      "yartrader",
      "env_yartrader",
      "git_operate:push",
    );

    expect(rehydrated).toBeDefined();
    expect(rehydrated?.id).toBe(req.id);
    expect(rehydrated?.status).toBe("PENDING");
    expect(rehydrated?.workspaceId).toBe("yartrader");
    expect(rehydrated?.environmentId).toBe("env_yartrader");
    expect(rehydrated?.ownerId).toBe("owner_sohrab");
    expect(rehydrated?.taskId).toBe("task_123");

    manager2.close();
  });

  it("2. approval grant and consumption works for exact request across restart", () => {
    const params = { cmd: "rm -rf /tmp/build" };
    const req = manager.requestApproval(
      "terminal_execute:run",
      params,
      300000,
      "yartrader",
      "env_yartrader",
    );

    manager.grantApproval(req.id, "owner_sohrab");

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const consumeRes = manager2.consumeApproval(
      "terminal_execute:run",
      params,
      "yartrader",
      "env_yartrader",
    );

    expect(consumeRes.valid).toBe(true);

    const reConsumeRes = manager2.consumeApproval(
      "terminal_execute:run",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(reConsumeRes.valid).toBe(false);
    expect(reConsumeRes.reason).toContain("already consumed");

    manager2.close();
  });

  it("3. modified parameters do not match approved request after restart", () => {
    const originalParams = { cmd: "ls -la" };
    const req = manager.requestApproval(
      "terminal_execute:run",
      originalParams,
      300000,
      "yartrader",
      "env_yartrader",
    );
    manager.grantApproval(req.id, "owner_sohrab");

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const modifiedParams = { cmd: "ls -la /etc" };
    const consumeRes = manager2.consumeApproval(
      "terminal_execute:run",
      modifiedParams,
      "yartrader",
      "env_yartrader",
    );

    expect(consumeRes.valid).toBe(false);
    expect(consumeRes.reason).toContain("No approval request found");

    manager2.close();
  });

  it("4. wrong workspace/environment/action does not match", () => {
    const params = { target: "prod" };
    const req = manager.requestApproval(
      "git_operate:deploy",
      params,
      300000,
      "workspace_a",
      "env_a",
    );
    manager.grantApproval(req.id, "owner_sohrab");

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const consumeWrongWs = manager2.consumeApproval(
      "git_operate:deploy",
      params,
      "workspace_b",
      "env_a",
    );
    expect(consumeWrongWs.valid).toBe(false);

    const consumeWrongEnv = manager2.consumeApproval(
      "git_operate:deploy",
      params,
      "workspace_a",
      "env_b",
    );
    expect(consumeWrongEnv.valid).toBe(false);

    manager2.close();
  });

  it("5. expired approval remains expired after restart", () => {
    const params = { foo: "bar" };
    const req = manager.requestApproval(
      "git_operate:commit",
      params,
      -1000,
      "yartrader",
      "env_yartrader",
    );

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const rehydrated = manager2.get(
      "git_operate:commit",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(rehydrated?.status).toBe("EXPIRED");

    const consumeRes = manager2.consumeApproval(
      "git_operate:commit",
      params,
      "yartrader",
      "env_yartrader",
    );
    expect(consumeRes.valid).toBe(false);
    expect(consumeRes.reason).toContain("expired");

    manager2.close();
  });

  it("6. rejected approval cannot be reused after restart", () => {
    const params = { test: true };
    const req = manager.requestApproval(
      "terminal_execute:run",
      params,
      300000,
      "yartrader",
      "env_yartrader",
    );
    manager.denyApproval(req.id);

    manager.close();
    const manager2 = new ApprovalManager(dbPath);

    const consumeRes = manager2.consumeApproval(
      "terminal_execute:run",
      params,
      "yartrader",
      "env_yartrader",
    );

    expect(consumeRes.valid).toBe(false);
    expect(consumeRes.reason).toContain("DENIED");

    manager2.close();
  });
});
