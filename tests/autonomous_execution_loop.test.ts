import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AutonomousExecutionLoop,
  DurableScheduler,
  DurableOperationalMemory,
  ControlledAutonomyEngine,
  AgentOrchestrator,
  AgentRegistry,
  PolicyEngine,
  ApprovalManager,
  SecureToolEcosystem,
  AcceptanceEngine,
  AuditManager,
  NotificationManager,
  ToolRegistry,
  Tool,
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Phase 8.5 — Autonomous Execution Loop", () => {
  const dbScheduler = join(tmpdir(), "test_phase_8_5_sched.db");
  const dbMemory = join(tmpdir(), "test_phase_8_5_mem.db");

  let scheduler: DurableScheduler;
  let memory: DurableOperationalMemory;
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let toolEcosystem: SecureToolEcosystem;
  let acceptanceEngine: AcceptanceEngine;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let autonomyEngine: ControlledAutonomyEngine;
  let loop: AutonomousExecutionLoop;

  beforeEach(() => {
    if (existsSync(dbScheduler)) unlinkSync(dbScheduler);
    if (existsSync(dbMemory)) unlinkSync(dbMemory);

    scheduler = new DurableScheduler(dbScheduler);
    memory = new DurableOperationalMemory(dbMemory);

    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);
    policyEngine = new PolicyEngine();
    approvalManager = new ApprovalManager();

    const registry = new ToolRegistry();
    const safeTool: Tool = {
      metadata: {
        id: "safe_tool",
        name: "Safe Tool",
        description: "Always succeeds",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true, output: { status: "ok" } }),
    };
    registry.register(safeTool);

    toolEcosystem = new SecureToolEcosystem(
      registry,
      policyEngine,
      approvalManager,
    );
    acceptanceEngine = new AcceptanceEngine();
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();

    policyEngine.setRule("safe_tool", "SAFE");

    agentRegistry.registerAgent({
      id: "auto_agent",
      name: "Auto Agent",
      role: "Developer",
      capabilities: ["software-development"],
      toolScopes: ["safe_tool"],
      workspaceScopes: ["yartrader"],
      provider: "MockProvider",
      model: "mock-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      memory,
    );

    loop = new AutonomousExecutionLoop(scheduler, memory, autonomyEngine, 100);
  });

  afterEach(async () => {
    await loop.stop();
    if (scheduler) scheduler.close();
    if (memory) memory.close();
    if (existsSync(dbScheduler)) unlinkSync(dbScheduler);
    if (existsSync(dbMemory)) unlinkSync(dbMemory);
  });

  it("should start, stop, and reflect running state correctly", async () => {
    expect(loop.getRunningState()).toBe(false);
    await loop.start();
    expect(loop.getRunningState()).toBe(true);
    await loop.stop();
    expect(loop.getRunningState()).toBe(false);
  });

  it("should execute due schedules through governed autonomy pipeline during loop tick", async () => {
    scheduler.createSchedule({
      id: "sched_auto_1",
      type: "ONCE",
      runAtUtc: "2026-01-01T00:00:00.000Z",
      payload: {
        taskId: "task_auto_100",
        workspaceId: "yartrader",
        toolId: "safe_tool",
      },
    });

    const checkTime = new Date("2026-01-01T00:01:00.000Z");
    const results = await loop.tick(checkTime);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("SUCCESS");
    expect(results[0].taskId).toBe("task_auto_100");

    // Schedule status transitioned to COMPLETED
    const updated = scheduler.getSchedule("sched_auto_1");
    expect(updated?.status).toBe("COMPLETED");
  });

  it("should enforce PolicyEngine and block unauthorized actions during tick", async () => {
    policyEngine.setRule("blocked_tool", "BLOCKED");

    scheduler.createSchedule({
      id: "sched_auto_blocked",
      type: "ONCE",
      runAtUtc: "2026-01-01T00:00:00.000Z",
      payload: {
        taskId: "task_auto_blocked",
        workspaceId: "yartrader",
        toolId: "blocked_tool",
      },
    });

    const checkTime = new Date("2026-01-01T00:01:00.000Z");
    const results = await loop.tick(checkTime);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe("BLOCKED");

    const updated = scheduler.getSchedule("sched_auto_blocked");
    expect(updated?.status).toBe("CANCELLED");
  });
});
