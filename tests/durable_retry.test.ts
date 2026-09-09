import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
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
  AutonomousActionRequest,
  AutonomyBudget,
  ExecutionContext,
  ToolRegistry,
  Tool,
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Phase 8.3 — Durable Retry & Failure Semantics", () => {
  const dbFile = join(tmpdir(), "test_phase_8_3_durable_retry.db");
  let memory: DurableOperationalMemory;
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let toolEcosystem: SecureToolEcosystem;
  let acceptanceEngine: AcceptanceEngine;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let engine: ControlledAutonomyEngine;

  beforeEach(() => {
    if (existsSync(dbFile)) unlinkSync(dbFile);

    memory = new DurableOperationalMemory(dbFile);
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);
    policyEngine = new PolicyEngine();
    approvalManager = new ApprovalManager();

    const registry = new ToolRegistry();
    const failingTool: Tool = {
      metadata: {
        id: "failing_tool",
        name: "Failing Tool",
        description: "Always fails",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: false, error: "Network timeout error" }),
    };
    registry.register(failingTool);

    toolEcosystem = new SecureToolEcosystem(
      registry,
      policyEngine,
      approvalManager,
    );
    acceptanceEngine = new AcceptanceEngine();
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();

    policyEngine.setRule("failing_tool", "SAFE");

    agentRegistry.registerAgent({
      id: "dev_agent",
      name: "Developer Agent",
      role: "Developer",
      capabilities: ["software-development"],
      toolScopes: ["failing_tool"],
      workspaceScopes: ["yartrader"],
      provider: "MockProvider",
      model: "mock-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    engine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      memory,
    );
  });

  afterEach(() => {
    if (memory) memory.close();
    if (existsSync(dbFile)) unlinkSync(dbFile);
  });

  it("should classify failure types correctly", () => {
    expect(engine.classifyFailure("Network timeout error")).toBe("RETRYABLE");
    expect(engine.classifyFailure("Security exception: blocked")).toBe(
      "NON_RETRYABLE",
    );
    expect(engine.classifyFailure("Unknown system crash")).toBe("INTERNAL");
  });

  it("should persist retry state durably on retryable failure", async () => {
    const request: AutonomousActionRequest = {
      taskId: "task_retry_101",
      workspaceId: "yartrader",
      toolId: "failing_tool",
      params: {},
    };

    const budget: AutonomyBudget = {
      maxActions: 5,
      maxRetries: 2,
      maxReplans: 1,
      usedActions: 0,
      usedRetries: 0,
      usedReplans: 0,
    };

    const mockContext: ExecutionContext = {
      executionId: "exec_retry_1",
      timestamp: new Date(),
    };

    const result = await engine.runControlledAction(
      request,
      budget,
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.retryState).toBeDefined();
    expect(result.retryState?.status).toBe("EXHAUSTED");

    // Verify durable memory state persistence
    const savedRetryState = engine.getRetryState("task_retry_101");
    expect(savedRetryState).not.toBeNull();
    expect(savedRetryState?.status).toBe("EXHAUSTED");
  });

  it("should enforce retry exhaustion budget limit and transition status to EXHAUSTED", async () => {
    const request: AutonomousActionRequest = {
      taskId: "task_exhaust_202",
      workspaceId: "yartrader",
      toolId: "failing_tool",
      params: {},
    };

    const budget: AutonomyBudget = {
      maxActions: 5,
      maxRetries: 1,
      maxReplans: 1,
      usedActions: 0,
      usedRetries: 1, // Budget already exhausted
      usedReplans: 0,
    };

    const mockContext: ExecutionContext = {
      executionId: "exec_retry_2",
      timestamp: new Date(),
    };

    const result = await engine.runControlledAction(
      request,
      budget,
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.retryState?.status).toBe("EXHAUSTED");

    const savedRetryState = engine.getRetryState("task_exhaust_202");
    expect(savedRetryState?.status).toBe("EXHAUSTED");
  });
});
