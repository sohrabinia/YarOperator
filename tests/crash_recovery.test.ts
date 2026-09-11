import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DurableScheduler,
  ControlledAutonomyEngine,
  DurableOperationalMemory,
  AgentOrchestrator,
  AgentRegistry,
  PolicyEngine,
  ApprovalManager,
  SecureToolEcosystem,
  AcceptanceEngine,
  AuditManager,
  NotificationManager,
  ToolRegistry,
  ScheduleDefinition,
  DurableRetryState,
  EnvironmentManager,
  Tool,
} from "../src/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function safelyRemoveDbFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err: any) {
    if (err && err.code !== "EBUSY" && err.code !== "ENOENT") {
      throw err;
    }
  }
}

describe("Phase 8.4 — Crash Recovery & Resume", () => {
  const dbScheduler = join(tmpdir(), "test_phase_8_4_scheduler.db");
  const dbMemory = join(tmpdir(), "test_phase_8_4_memory.db");

  beforeEach(() => {
    safelyRemoveDbFile(dbScheduler);
    safelyRemoveDbFile(dbMemory);
  });

  afterEach(() => {
    safelyRemoveDbFile(dbScheduler);
    safelyRemoveDbFile(dbMemory);
  });

  it("should reconcile stale claimed occurrences after worker crash/restart", () => {
    let scheduler1 = new DurableScheduler(dbScheduler);
    const schedule: ScheduleDefinition = {
      id: "crash_sched_1",
      type: "ONCE",
      runAtUtc: "2026-01-01T00:00:00.000Z",
    };

    scheduler1.createSchedule(schedule);
    const occ = scheduler1.scheduleNextOccurrence(
      "crash_sched_1",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(occ).not.toBeNull();

    // Worker 1 claims occurrence
    const claimed = scheduler1.claimDueOccurrence("worker_crash_1");
    expect(claimed?.status).toBe("CLAIMED");

    // Worker 1 crashes without completing task. Disconnect scheduler1.
    scheduler1.close();

    // Restart scheduler instance
    let scheduler2 = new DurableScheduler(dbScheduler);

    // Reconcile stale claims with threshold = 0ms (force stale recovery)
    const reconciledCount = scheduler2.reconcileStaleClaims(0);
    expect(reconciledCount).toBe(1);

    // Verify occurrence was reset to PENDING and can be safely re-claimed by active Worker 2
    const reclaimed = scheduler2.claimDueOccurrence("worker_recovered_2");
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe("CLAIMED");
    expect(reclaimed?.claimedBy).toBe("worker_recovered_2");

    scheduler2.close();
  });

  it("should detect and recover pending interrupted task retries from durable operational memory", async () => {
    let memory1 = new DurableOperationalMemory(dbMemory);
    const pendingRetry: DurableRetryState = {
      taskId: "task_interrupted_777",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      attemptNumber: 1,
      maxRetries: 3,
      failureClassification: "RETRYABLE",
      failureReason: "Network socket drop during execution",
      nextRetryAtIso: new Date(Date.now() - 1000).toISOString(), // Ready for retry
      status: "RETRYING",
      updatedAtIso: new Date().toISOString(),
    };

    memory1.saveState("task_retry:task_interrupted_777", pendingRetry as any);
    memory1.close();

    // Reopen memory after crash
    let memory2 = new DurableOperationalMemory(dbMemory);
    const agentRegistry = new AgentRegistry();
    const orchestrator = new AgentOrchestrator(agentRegistry);
    const policyEngine = new PolicyEngine();
    const approvalManager = new ApprovalManager();

    const workspacePolicyManager = new WorkspacePolicyManager();
    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["git_operate"],
        allowedRoots: [process.cwd()],
      }),
    );

    const environmentManager = new EnvironmentManager();
    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Env",
      type: "PRODUCTION",
      capabilities: ["git_operate"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    const toolRegistry = new ToolRegistry();
    const toolEcosystem = new SecureToolEcosystem(
      toolRegistry,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );
    const acceptanceEngine = new AcceptanceEngine();
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager();

    const gitTool: Tool = {
      metadata: {
        id: "git_operate",
        name: "Git Operate",
        description: "Git tool for recovery",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true, output: { status: "clean" } }),
    };
    toolRegistry.register(gitTool);
    policyEngine.setRule("git_operate", "SAFE");

    agentRegistry.registerAgent({
      id: "recovery_agent",
      name: "Recovery Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["git_operate"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const engine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      memory2,
      environmentManager,
    );

    const recovery = await engine.recoverInterruptedTasks(new Date());
    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.resumedTasks).toContain("task_interrupted_777");

    memory2.close();
  });
});
