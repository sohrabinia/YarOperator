import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DurableScheduler,
  ScheduleDefinition,
  SchedulerError,
  SecureToolEcosystem,
  WorkspacePolicyManager,
  WorkspacePolicy,
  EnvironmentManager,
  ToolRegistry,
  Tool,
  ToolResult,
  ExecutionContext,
  ControlledAutonomyEngine,
  AgentRegistry,
  AgentOrchestrator,
  PolicyEngine,
  ApprovalManager,
  AcceptanceEngine,
  AuditManager,
  NotificationManager,
  DurableOperationalMemory,
  AutonomousExecutionLoop,
} from "../src/index.js";
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

class SpyExecutionTool implements Tool {
  public executeCount = 0;

  constructor(
    public metadata = {
      id: "spy_exec_tool",
      name: "Spy Execution Tool",
      description: "Monitors executions",
      safetyLevel: "SAFE" as const,
    },
  ) {}

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.executeCount++;
    return {
      success: true,
      output: { executeCount: this.executeCount, params },
    };
  }
}

describe("Phase 8.2 — Durable Scheduler Primitive", () => {
  const dbFile = join(tmpdir(), "test_durable_scheduler_p82.db");

  beforeEach(() => {
    safelyRemoveDbFile(dbFile);
  });

  afterEach(() => {
    safelyRemoveDbFile(dbFile);
  });

  it("CASE A: Create scheduled job -> persists successfully", () => {
    const scheduler = new DurableScheduler(dbFile);

    const sched: ScheduleDefinition = {
      id: "sched_1",
      type: "ONCE",
      runAtUtc: "2026-06-01T12:00:00.000Z",
      payload: { taskId: "t_100", action: "sync" },
    };

    const record = scheduler.createSchedule(sched);
    expect(record.id).toBe("sched_1");
    expect(record.status).toBe("SCHEDULED");
    expect(record.payload).toEqual({ taskId: "t_100", action: "sync" });

    const retrieved = scheduler.getSchedule("sched_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("sched_1");

    const list = scheduler.listSchedules();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("sched_1");

    scheduler.close();
  });

  it("CASE B: Recreate scheduler -> scheduled job survives restart", () => {
    let scheduler1 = new DurableScheduler(dbFile);
    scheduler1.createSchedule({
      id: "durable_sched_1",
      type: "INTERVAL",
      intervalMs: 5000,
      timezone: "UTC",
      payload: { jobName: "nightly_cleanup" },
    });
    scheduler1.close();

    // Recreate scheduler instance using same underlying database store
    let scheduler2 = new DurableScheduler(dbFile);
    const reloaded = scheduler2.getSchedule("durable_sched_1");

    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe("durable_sched_1");
    expect(reloaded?.type).toBe("INTERVAL");
    expect(reloaded?.payload).toEqual({ jobName: "nightly_cleanup" });

    scheduler2.close();
  });

  it("CASE C: Not-yet-due job -> no execution / not returned as due", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "future_due",
      type: "ONCE",
      runAtUtc: "2026-01-01T14:00:00.000Z",
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const dueSchedules = scheduler.getDueSchedules(checkTime);

    expect(dueSchedules.length).toBe(0);

    scheduler.close();
  });

  it("CASE D: Due job -> returned as due and dispatched", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "past_due",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const dueSchedules = scheduler.getDueSchedules(checkTime);

    expect(dueSchedules.length).toBe(1);
    expect(dueSchedules[0].id).toBe("past_due");

    scheduler.close();
  });

  it("CASE E: Repeated tick / claim -> same occurrence is not claimed twice", () => {
    const scheduler = new DurableScheduler(dbFile);

    const pastTime = new Date(Date.now() - 5000).toISOString();
    scheduler.createSchedule({
      id: "sched_claim_test",
      type: "ONCE",
      runAtUtc: pastTime,
    });

    scheduler.scheduleNextOccurrence(
      "sched_claim_test",
      new Date(Date.now() - 10000),
    );

    // Worker 1 claims due occurrence
    const claimed1 = scheduler.claimDueOccurrence("worker_1");
    expect(claimed1).not.toBeNull();
    expect(claimed1?.status).toBe("CLAIMED");

    // Second claim attempt for same occurrence returns null
    const claimed2 = scheduler.claimDueOccurrence("worker_2");
    expect(claimed2).toBeNull();

    scheduler.close();
  });

  it("CASE F: Disabled job -> no execution / not returned as due", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "disabled_job",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      enabled: false,
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const dueSchedules = scheduler.getDueSchedules(checkTime);

    expect(dueSchedules.length).toBe(0);

    const occ = scheduler.scheduleNextOccurrence("disabled_job");
    expect(occ).toBeNull();

    scheduler.close();
  });

  it("CASE G: Scheduler dispatch uses existing execution boundary and does not bypass authorization/security", async () => {
    const scheduler = new DurableScheduler(dbFile);
    const memory = new DurableOperationalMemory(":memory:");

    const spyTool = new SpyExecutionTool();
    const registry = new ToolRegistry();
    registry.register(spyTool);

    const policyEngine = new PolicyEngine();
    policyEngine.setRule("spy_exec_tool", "SAFE");
    const approvalManager = new ApprovalManager();

    const workspacePolicyManager = new WorkspacePolicyManager();
    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_exec_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    const environmentManager = new EnvironmentManager();
    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Env",
      type: "PRODUCTION",
      capabilities: ["spy_exec_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    const toolEcosystem = new SecureToolEcosystem(
      registry,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );

    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent({
      id: "sched_agent",
      name: "Sched Agent",
      capabilities: ["software-development"],
      toolScopes: ["spy_exec_tool"],
      workspaceScopes: ["yartrader"],
      provider: "MockProvider",
      model: "mock-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });
    const orchestrator = new AgentOrchestrator(agentRegistry);

    const autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      new AcceptanceEngine(),
      new AuditManager(),
      new NotificationManager(),
      memory,
      environmentManager,
    );

    const loop = new AutonomousExecutionLoop(
      scheduler,
      memory,
      autonomyEngine,
      100,
    );

    // Create schedule for authorized tool
    scheduler.createSchedule({
      id: "sched_authorized",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      payload: {
        taskId: "task_auth_1",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        toolId: "spy_exec_tool",
      },
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const results = await loop.tick(checkTime);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("SUCCESS");
    expect(spyTool.executeCount).toBe(1);

    scheduler.close();
    memory.close();
  });

  it("should reject malformed schedule definitions with structured SchedulerError", () => {
    const scheduler = new DurableScheduler(dbFile);

    expect(() =>
      scheduler.createSchedule({
        id: "",
        type: "ONCE",
        runAtUtc: "2026-01-01T10:00:00.000Z",
      }),
    ).toThrow(SchedulerError);

    expect(() =>
      scheduler.createSchedule({
        id: "s_invalid_type",
        type: "UNKNOWN" as any,
      }),
    ).toThrow("Invalid schedule type 'UNKNOWN'");

    expect(() =>
      scheduler.createSchedule({
        id: "s_invalid_date",
        type: "ONCE",
        runAtUtc: "not_a_valid_date",
      }),
    ).toThrow("Invalid runAtUtc timestamp");

    scheduler.close();
  });

  it("should maintain schedule isolation and avoid cross-schedule parameter bleeding", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "job_a",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      payload: { env: "prod", worker: "w1" },
    });

    scheduler.createSchedule({
      id: "job_b",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      payload: { env: "staging", worker: "w2" },
    });

    const jobA = scheduler.getSchedule("job_a");
    const jobB = scheduler.getSchedule("job_b");

    expect(jobA?.payload).toEqual({ env: "prod", worker: "w1" });
    expect(jobB?.payload).toEqual({ env: "staging", worker: "w2" });

    scheduler.close();
  });
});
