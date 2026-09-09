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
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Phase 8.4 — Crash Recovery & Resume", () => {
  const dbScheduler = join(tmpdir(), "test_phase_8_4_scheduler.db");
  const dbMemory = join(tmpdir(), "test_phase_8_4_memory.db");

  beforeEach(() => {
    if (existsSync(dbScheduler)) unlinkSync(dbScheduler);
    if (existsSync(dbMemory)) unlinkSync(dbMemory);
  });

  afterEach(() => {
    if (existsSync(dbScheduler)) unlinkSync(dbScheduler);
    if (existsSync(dbMemory)) unlinkSync(dbMemory);
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

  it("should detect and recover pending interrupted task retries from durable operational memory", () => {
    let memory1 = new DurableOperationalMemory(dbMemory);
    const pendingRetry: DurableRetryState = {
      taskId: "task_interrupted_777",
      workspaceId: "yartrader",
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
    const toolRegistry = new ToolRegistry();
    const toolEcosystem = new SecureToolEcosystem(
      toolRegistry,
      policyEngine,
      approvalManager,
    );
    const acceptanceEngine = new AcceptanceEngine();
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager();

    const engine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      memory2,
    );

    const recovery = engine.recoverInterruptedTasks(new Date());
    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.resumedTasks).toContain("task_interrupted_777");

    memory2.close();
  });
});
