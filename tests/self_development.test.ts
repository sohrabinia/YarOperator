import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentRegistry,
  AgentOrchestrator,
  PolicyEngine,
  ApprovalManager,
  SecureToolEcosystem,
  AcceptanceEngine,
  AuditManager,
  NotificationManager,
  DevelopmentTaskManager,
  SelfDevelopmentTaskRunner,
  ExecutionContext,
  DevelopmentTask,
} from "../src/index.js";

describe("YarOperator First Controlled Self-Development Task", () => {
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let approvalManager: ApprovalManager;
  let policyEngine: PolicyEngine;
  let toolEcosystem: SecureToolEcosystem;
  let acceptanceEngine: AcceptanceEngine;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let taskManager: DevelopmentTaskManager;
  let taskRunner: SelfDevelopmentTaskRunner;

  const mockContext: ExecutionContext = {
    executionId: "self_dev_exec_1",
    timestamp: new Date(),
  };

  beforeEach(() => {
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    toolEcosystem = new SecureToolEcosystem();
    acceptanceEngine = new AcceptanceEngine();
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    taskManager = new DevelopmentTaskManager();

    taskRunner = new SelfDevelopmentTaskRunner(
      orchestrator,
      policyEngine,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
    );

    // Register a valid development agent
    agentRegistry.registerAgent({
      id: "jules_dev_agent",
      name: "Jules Development Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["git_operate", "terminal_execute"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });
  });

  it("Test 1: should execute valid self-development task lifecycle cleanly", async () => {
    policyEngine.setRule("git_operate", "SAFE");

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "Add utility helper module",
      description: "Implement non-security-critical utility helper",
      goal: "Enhance self-development utility capabilities",
      priority: "medium",
      risk: "SAFE",
      allowedCapabilities: ["software-development"],
      allowedTools: ["git_operate"],
      acceptanceCriteria: { requiredRoutes: ["/"] },
    });

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      { action: "status" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(task.status).toBe("COMPLETED");
    expect(task.evidence).toBeDefined();
    expect(task.evidence?.provider).toBe("JulesProvider");

    const events = await auditManager.queryEvents({ workspaceId: "yartrader" });
    expect(events.length).toBeGreaterThan(0);

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("TASK_COMPLETED");
  });

  it("Test 2: should reject task requesting unauthorized tool outside scope", async () => {
    policyEngine.setRule("git_operate", "SAFE");

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "Unauthorized tool attempt",
      description: "Attempting to run blocked_tool",
      goal: "Test tool allowlist scoping",
      allowedCapabilities: ["software-development"],
      allowedTools: ["git_operate"], // blocked_tool is NOT allowed
    });

    const result = await taskRunner.runTask(
      task,
      "blocked_tool",
      {},
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not authorized in task scope");
    expect(task.status).toBe("FAILED");
  });

  it("Test 3: should fail closed if self-development attempts protected self-modification without approval", async () => {
    policyEngine.setRule("policy_modify_tool", "BLOCKED");

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "Self-modification attempt",
      description: "Attempting to modify PolicyEngine rules",
      goal: "Test self-authorization boundary",
      allowedCapabilities: ["software-development"],
      allowedTools: ["policy_modify_tool"],
    });

    const result = await taskRunner.runTask(
      task,
      "policy_modify_tool",
      {},
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("explicitly BLOCKED by policy");
    expect(task.status).toBe("FAILED");
  });

  it("Test 4: should fail closed on missing workspace or repository scope", async () => {
    const task: DevelopmentTask = {
      id: "unscoped_task",
      workspaceId: "", // Missing workspace ID
      title: "Unscoped",
      description: "Unscoped",
      goal: "Unscoped",
      priority: "medium",
      risk: "SAFE",
      status: "CREATED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      {},
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required task execution scope");
    expect(task.status).toBe("FAILED");
  });

  it("Test 5: should verify that provider identity changes do not alter execution authority", async () => {
    // Register alternative agent with different provider
    agentRegistry.registerAgent({
      id: "claude_dev_agent",
      name: "Claude Dev Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["git_operate"],
      provider: "AnthropicProvider",
      model: "claude-3-5",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    policyEngine.setRule("git_operate", "BLOCKED"); // Explicitly BLOCKED by policy

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "Provider authority test",
      description: "Testing provider switching authority",
      goal: "Verify provider independence",
      allowedCapabilities: ["software-development"],
      allowedTools: ["git_operate"],
    });

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      {},
      mockContext,
    );

    // Both Jules and Claude agents are subject to the same deterministic PolicyEngine
    expect(result.success).toBe(false);
    expect(result.error).toContain("BLOCKED by policy");
    expect(task.status).toBe("FAILED");
  });

  it("Test 6: should fail task when acceptance criteria evaluation fails", async () => {
    policyEngine.setRule("git_operate", "SAFE");

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "Acceptance failure test",
      description: "Testing acceptance failure",
      goal: "Verify acceptance engine gating",
      allowedCapabilities: ["software-development"],
      allowedTools: ["git_operate"],
      acceptanceCriteria: { requiredRoutes: ["/non_existent_route"] },
      actualRoutes: [], // Actual routes missing required route
    });

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      {},
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Acceptance criteria failed");
    expect(task.status).toBe("FAILED");
  });

  it("Test 7: should enforce workspace isolation during agent selection", async () => {
    // Register agent scoped ONLY to amlakbashi workspace
    agentRegistry.registerAgent({
      id: "amlakbashi_only_agent",
      name: "Amlakbashi Agent",
      capabilities: ["amlakbashi-specialist"],
      workspaceScopes: ["amlakbashi"],
      toolScopes: ["git_operate"],
      provider: "SpecialistProvider",
      model: "spec-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const task = taskManager.createTask({
      workspaceId: "yartrader", // Requesting from yartrader workspace
      repository: "sohrabinia/YarOperator",
      title: "Workspace isolation test",
      description: "Attempting cross-workspace agent selection",
      goal: "Verify isolation",
      allowedCapabilities: ["amlakbashi-specialist"],
      allowedTools: ["git_operate"],
    });

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      {},
      mockContext,
    );

    // Fails because agent is scoped only to amlakbashi, not yartrader
    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent selection failed.");
    expect(task.status).toBe("FAILED");
  });

  it("Test 8: Real repository-scoped self-development task demonstration", async () => {
    policyEngine.setRule("git_operate", "SAFE");

    const task = taskManager.createTask({
      workspaceId: "yartrader",
      repository: "sohrabinia/YarOperator",
      title: "First Controlled Self-Development Demonstration",
      description: "Execute scoped self-development task against YarOperator",
      goal: "Demonstrate YarOperator acting as orchestrator for its own development",
      priority: "high",
      risk: "SAFE",
      allowedCapabilities: ["software-development"],
      allowedTools: ["git_operate"],
      acceptanceCriteria: { requiredRoutes: ["/"] },
    });

    const result = await taskRunner.runTask(
      task,
      "git_operate",
      { action: "status" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(task.status).toBe("COMPLETED");
    expect(task.evidence?.taskId).toBe(task.id);
    expect(task.evidence?.acceptancePassed).toBe(true);
  });
});
