import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentRegistry } from "../src/core/agent/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";
import { TaskExecutor, TaskDefinition } from "../src/core/task/index.js";
import {
  Tool,
  ExecutionContext,
  ToolResult,
  ToolMetadata,
} from "../src/core/contracts/index.js";

describe("M4 — Task Executor Test Suite", () => {
  let registry: AgentRegistry;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let toolEcosystem: SecureToolEcosystem;
  let orchestrator: AgentOrchestrator;
  let taskExecutor: TaskExecutor;

  // Mock Tools
  class MockStep1Tool implements Tool {
    metadata: ToolMetadata = {
      id: "tool_step_1",
      name: "Step 1 Tool",
      description: "First step execution tool",
      safetyLevel: "SAFE",
    };
    async execute(
      params: any,
      _context: ExecutionContext,
    ): Promise<ToolResult> {
      return {
        success: true,
        output: {
          routes: ["/api/v1/health"],
          buildTimeMs: 120,
          data: params.inputData || "step1_out",
        },
      };
    }
  }

  class MockStep2Tool implements Tool {
    metadata: ToolMetadata = {
      id: "tool_step_2",
      name: "Step 2 Tool",
      description: "Second step execution tool",
      safetyLevel: "SAFE",
    };
    async execute(
      params: any,
      _context: ExecutionContext,
    ): Promise<ToolResult> {
      return {
        success: true,
        output: {
          routes: ["/api/v1/health", "/api/v1/users"],
          receivedFromStep1: params.fromStep1,
        },
      };
    }
  }

  class MockFailingTool implements Tool {
    metadata: ToolMetadata = {
      id: "tool_failing",
      name: "Failing Tool",
      description: "Always fails execution",
      safetyLevel: "SAFE",
    };
    async execute(
      _params: any,
      _context: ExecutionContext,
    ): Promise<ToolResult> {
      return {
        success: false,
        error: "Simulated step failure in tool.",
      };
    }
  }

  beforeEach(() => {
    registry = new AgentRegistry();
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    toolEcosystem = new SecureToolEcosystem(
      undefined,
      policyEngine,
      approvalManager,
    );

    // Register Tools
    toolEcosystem.registerTool(new MockStep1Tool());
    toolEcosystem.registerTool(new MockStep2Tool());
    toolEcosystem.registerTool(new MockFailingTool());

    // Policy rules
    policyEngine.setRule("tool_step_1", "SAFE");
    policyEngine.setRule("tool_step_2", "SAFE");
    policyEngine.setRule("tool_failing", "SAFE");

    // Register Agents
    registry.registerAgent({
      id: "agent_dev",
      name: "Software Dev Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["ws_m4"],
      toolScopes: ["tool_step_1"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    registry.registerAgent({
      id: "agent_term",
      name: "Terminal Execution Agent",
      capabilities: ["terminal-execution"],
      workspaceScopes: ["ws_m4"],
      toolScopes: ["tool_step_2"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    registry.registerAgent({
      id: "agent_fail",
      name: "Failing Agent",
      capabilities: ["failing-capability"],
      workspaceScopes: ["ws_m4"],
      toolScopes: ["tool_failing"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    orchestrator = new AgentOrchestrator(registry, policyEngine, toolEcosystem);
    taskExecutor = new TaskExecutor(orchestrator);
  });

  it("1. Executes single-step task successfully", async () => {
    const task: TaskDefinition = {
      id: "task_1",
      name: "Single Step Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: { inputData: "hello" },
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.executedSteps.length).toBe(1);
    expect(res.executedSteps[0].status).toBe("COMPLETED");
    expect(res.executedSteps[0].toolId).toBe("tool_step_1");
  });

  it("2. Executes ordered multi-step task and propagates outputs", async () => {
    const task: TaskDefinition = {
      id: "task_2",
      name: "Multi Step Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: { inputData: "val_step1" },
        },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: (prev) => ({ fromStep1: (prev.step_1 as any)?.data }),
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.executedSteps.length).toBe(2);
    expect(res.executedSteps[0].stepId).toBe("step_1");
    expect(res.executedSteps[1].stepId).toBe("step_2");
    expect((res.executedSteps[1].output as any)?.receivedFromStep1).toBe(
      "val_step1",
    );
  });

  it("3. Enforces DAG dependency ordering regardless of initial step order", async () => {
    const task: TaskDefinition = {
      id: "task_dag_order",
      name: "DAG Order Task",
      workspaceId: "ws_m4",
      steps: [
        // Dependent step defined FIRST
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: (prev) => ({ fromStep1: (prev.step_1 as any)?.data }),
        },
        // Prerequisite step defined SECOND
        {
          id: "step_1",
          capability: "software-development",
          params: { inputData: "prereq_val" },
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps[0].stepId).toBe("step_1");
    expect(res.executedSteps[1].stepId).toBe("step_2");
  });

  it("4. Prerequisite success allows dependent step to execute", async () => {
    const task: TaskDefinition = {
      id: "task_prereq_success",
      name: "Prereq Success Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_1", capability: "software-development", params: {} },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps.length).toBe(2);
  });

  it("5. Prerequisite failure halts task and prevents dependent step from executing", async () => {
    const task: TaskDefinition = {
      id: "task_prereq_fail",
      name: "Prereq Failure Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_failing", capability: "failing-capability", params: {} },
        {
          id: "step_dependent",
          capability: "terminal-execution",
          dependsOn: ["step_failing"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.executedSteps.length).toBe(1);
    expect(res.executedSteps[0].stepId).toBe("step_failing");
    expect(res.executedSteps.some((s) => s.stepId === "step_dependent")).toBe(
      false,
    );
  });

  it("6. Policy BLOCKED step halts task execution cleanly", async () => {
    policyEngine.setRule("tool_step_1", "BLOCKED");

    const task: TaskDefinition = {
      id: "task_policy_blocked",
      name: "Policy Blocked Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_1", capability: "software-development", params: {} },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
    expect(res.executedSteps[0].status).toBe("BLOCKED");
    expect(res.executedSteps.length).toBe(1);
  });

  it("7. Policy APPROVAL_REQUIRED step halts task execution cleanly awaiting approval", async () => {
    policyEngine.setRule("tool_step_1", "APPROVAL_REQUIRED");

    const task: TaskDefinition = {
      id: "task_approval_required",
      name: "Approval Required Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_1", capability: "software-development", params: {} },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(false);
    expect(res.status).toBe("APPROVAL_REQUIRED");
    expect(res.executedSteps[0].status).toBe("APPROVAL_REQUIRED");
    expect(res.executedSteps.length).toBe(1);
  });

  it("8. Deterministic verification success allows step to complete", async () => {
    const task: TaskDefinition = {
      id: "task_verify_success",
      name: "Verification Success Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: {},
          verificationCriteria: { requiredRoutes: ["/api/v1/health"] },
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps[0].verification?.passed).toBe(true);
  });

  it("9. Deterministic verification failure halts task execution", async () => {
    const task: TaskDefinition = {
      id: "task_verify_failure",
      name: "Verification Failure Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: {},
          verificationCriteria: { requiredRoutes: ["/api/v1/missing_route"] },
        },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.executedSteps[0].verification?.passed).toBe(false);
    expect(res.executedSteps.length).toBe(1);
  });

  it("10. Structured partial task result reported when step 2 fails after step 1 succeeds", async () => {
    const task: TaskDefinition = {
      id: "task_partial_failure",
      name: "Partial Failure Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_1", capability: "software-development", params: {} },
        {
          id: "step_failing",
          capability: "failing-capability",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(false);
    expect(res.status).toBe("PARTIAL_FAILURE");
    expect(res.executedSteps.length).toBe(2);
    expect(res.executedSteps[0].status).toBe("COMPLETED");
    expect(res.executedSteps[1].status).toBe("FAILED");
  });

  it("11. Preserves M3 capability resolution within TaskExecutor", async () => {
    const task: TaskDefinition = {
      id: "task_m3_capability",
      name: "M3 Capability Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_m3",
          brainResult: { intent: "ACTION", actionGoal: "VERIFICATION" }, // M3 ActionGoal
          params: {},
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps[0].capability).toBe("terminal-execution");
  });

  it("12. No raw command text tool selection occurs in TaskExecutor", async () => {
    const task: TaskDefinition = {
      id: "task_no_raw_text",
      name: "No Raw Text Task",
      workspaceId: "ws_m4",
      brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: {
            rawCommandText:
              "arbitrary string containing git or terminal keywords",
          },
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps[0].capability).toBe("software-development");
  });

  it("13. TaskExecutor never invokes tools directly (all steps pass through AgentOrchestrator)", async () => {
    const orchestratorSpy = vi.spyOn(orchestrator, "orchestrateBrainResult");

    const task: TaskDefinition = {
      id: "task_orchestrator_pass",
      name: "Pass Through Orchestrator Task",
      workspaceId: "ws_m4",
      steps: [{ id: "step_1", capability: "software-development", params: {} }],
    };

    await taskExecutor.executeTask(task);
    expect(orchestratorSpy).toHaveBeenCalledTimes(1);
  });

  it("14. Reuses WorkflowValidator for DAG cycle and duplicate step ID detection", async () => {
    // Duplicate step ID
    const taskDuplicate: TaskDefinition = {
      id: "task_duplicate",
      name: "Duplicate Step ID Task",
      workspaceId: "ws_m4",
      steps: [
        { id: "step_1", capability: "software-development", params: {} },
        { id: "step_1", capability: "terminal-execution", params: {} },
      ],
    };

    const resDup = await taskExecutor.executeTask(taskDuplicate);
    expect(resDup.success).toBe(false);
    expect(resDup.error).toContain("Duplicate step ID 'step_1'");

    // Cyclic dependency
    const taskCycle: TaskDefinition = {
      id: "task_cycle",
      name: "Cyclic Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          dependsOn: ["step_2"],
          params: {},
        },
        {
          id: "step_2",
          capability: "terminal-execution",
          dependsOn: ["step_1"],
          params: {},
        },
      ],
    };

    const resCycle = await taskExecutor.executeTask(taskCycle);
    expect(resCycle.success).toBe(false);
    expect(resCycle.error).toContain("Cyclic dependency detected");
  });

  it("15. Reuses AcceptanceEngine for output verification", async () => {
    const task: TaskDefinition = {
      id: "task_acceptance_reuse",
      name: "Acceptance Engine Reuse Task",
      workspaceId: "ws_m4",
      steps: [
        {
          id: "step_1",
          capability: "software-development",
          params: {},
          verificationCriteria: { requiredRoutes: ["/api/v1/health"] },
        },
      ],
    };

    const res = await taskExecutor.executeTask(task);
    expect(res.success).toBe(true);
    expect(res.executedSteps[0].verification).toBeDefined();
    expect(res.executedSteps[0].verification?.passed).toBe(true);
  });
});
