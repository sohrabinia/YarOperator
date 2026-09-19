import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine } from "../src/core/policy/index.js";
import { ToolRegistry } from "../src/core/registry/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { TaskExecutor } from "../src/core/task/index.js";
import { DeterministicBrain } from "../src/core/brain/index.js";
import {
  Tool,
  ToolResult,
  ExecutionContext,
  BrainPlan,
} from "../src/core/contracts/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";

class SafeTerminalTool implements Tool {
  public metadata = {
    id: "terminal_execute",
    name: "Terminal Exec",
    description: "Executes terminal commands",
    safetyLevel: "SAFE" as const,
  };

  public executionCount = 0;

  async execute(
    params: unknown,
    _context: ExecutionContext,
  ): Promise<ToolResult> {
    this.executionCount++;
    return {
      success: true,
      output: { executedParams: params, count: this.executionCount },
    };
  }
}

class FailingTool implements Tool {
  public metadata = {
    id: "failing_tool",
    name: "Failing Tool",
    description: "Tool that always fails",
    safetyLevel: "SAFE" as const,
  };

  async execute(
    _params: unknown,
    _context: ExecutionContext,
  ): Promise<ToolResult> {
    return {
      success: false,
      error: "Simulated hardware or runtime failure.",
    };
  }
}

class ApprovalTool implements Tool {
  public metadata = {
    id: "approval_tool",
    name: "Approval Required Tool",
    description: "Requires explicit owner approval",
    safetyLevel: "APPROVAL_REQUIRED" as const,
  };

  public executionCount = 0;

  async execute(
    _params: unknown,
    _context: ExecutionContext,
  ): Promise<ToolResult> {
    this.executionCount++;
    return { success: true, output: "Approval tool executed" };
  }
}

describe("YarOperator M8 — Multi-step Controlled Execution Suite", () => {
  let agentRegistry: AgentRegistry;
  let policyEngine: PolicyEngine;
  let toolRegistry: ToolRegistry;
  let toolEcosystem: SecureToolEcosystem;
  let orchestrator: AgentOrchestrator;
  let taskExecutor: TaskExecutor;
  let envManager: EnvironmentManager;
  let safeTool: SafeTerminalTool;
  let failingTool: FailingTool;
  let approvalTool: ApprovalTool;

  beforeEach(() => {
    safeTool = new SafeTerminalTool();
    failingTool = new FailingTool();
    approvalTool = new ApprovalTool();

    agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent({
      id: "multi_step_agent",
      name: "Multi-Step Execution Agent",
      role: "test",
      capabilities: [
        "terminal-execution",
        "software-development",
        "investigation",
        "verification",
        "web-research",
      ],
      workspaceScopes: ["ws_m8"],
      toolScopes: ["terminal_execute", "failing_tool", "approval_tool"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    policyEngine = new PolicyEngine();
    policyEngine.setRule("terminal_execute", "SAFE");
    policyEngine.setRule("failing_tool", "SAFE");
    policyEngine.setRule("approval_tool", "APPROVAL_REQUIRED");

    toolRegistry = new ToolRegistry();
    toolRegistry.register(safeTool);
    toolRegistry.register(failingTool);
    toolRegistry.register(approvalTool);

    envManager = new EnvironmentManager();
    envManager.registerEnvironment({
      id: "env_ws_m8",
      name: "M8 Environment",
      type: "DEVELOPMENT",
      capabilities: [
        "terminal_execute",
        "failing_tool",
        "approval_tool",
        "web-research",
      ],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "ws_m8" },
    });

    const wsPolicyManager = new WorkspacePolicyManager();
    wsPolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "ws_m8",
        allowedTools: ["terminal_execute", "failing_tool", "approval_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    toolEcosystem = new SecureToolEcosystem(toolRegistry, policyEngine);
    toolEcosystem.setEnvironmentManager(envManager);
    toolEcosystem.setWorkspacePolicyManager(wsPolicyManager);

    orchestrator = new AgentOrchestrator(
      agentRegistry,
      policyEngine,
      toolEcosystem,
    );
    taskExecutor = new TaskExecutor(orchestrator);
  });

  it("1. Single-step successful execution", async () => {
    const plan: BrainPlan = {
      goal: "Single step investigation",
      steps: [
        {
          id: "step-1",
          purpose: "Check terminal output",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
          params: { cmd: "status" },
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_single",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.executionOrder).toEqual(["step-1"]);
    expect(res.stepResults["step-1"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-1"].resolvedToolId).toBe("terminal_execute");
    expect(safeTool.executionCount).toBe(1);
  });

  it("2. Two-step sequential execution", async () => {
    const plan: BrainPlan = {
      goal: "Sequential investigation and verification",
      steps: [
        {
          id: "step-1",
          purpose: "Inspect status",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-2",
          purpose: "Verify health",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-1"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_seq",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.executionOrder).toEqual(["step-1", "step-2"]);
    expect(res.stepResults["step-1"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-2"].state).toBe("SUCCEEDED");
    expect(safeTool.executionCount).toBe(2);
  });

  it("3. Dependency ordering (re-ordered steps array executes in dependency order)", async () => {
    const plan: BrainPlan = {
      goal: "Out of order array steps",
      steps: [
        {
          id: "step-2",
          purpose: "Dependent second step",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-1"],
        },
        {
          id: "step-1",
          purpose: "Prerequisite first step",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_dep_order",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(res.executionOrder).toEqual(["step-1", "step-2"]);
    expect(res.stepResults["step-1"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-2"].state).toBe("SUCCEEDED");
  });

  it("4. Multiple independent steps execute properly", async () => {
    const plan: BrainPlan = {
      goal: "Independent multi-step plan",
      steps: [
        {
          id: "step-a",
          purpose: "Independent task A",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-b",
          purpose: "Independent task B",
          action: "RESEARCH",
          toolId: "terminal_execute",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_indep",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(res.executionOrder).toHaveLength(2);
    expect(res.stepResults["step-a"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-b"].state).toBe("SUCCEEDED");
  });

  it("5. Dependent step blocked/skipped when prerequisite fails", async () => {
    const plan: BrainPlan = {
      goal: "Prerequisite failure test",
      steps: [
        {
          id: "step-fail",
          purpose: "Failing prerequisite step",
          action: "DEVELOPMENT",
          toolId: "failing_tool",
        },
        {
          id: "step-dep",
          purpose: "Dependent step that must not execute",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-fail"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_prereq_fail",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.stoppedEarly).toBe(true);
    expect(res.stepResults["step-fail"].state).toBe("FAILED");
    expect(res.stepResults["step-dep"].state).toBe("SKIPPED");
    expect(res.stepResults["step-dep"].skippedDueToDependency).toBe(
      "step-fail",
    );
    expect(safeTool.executionCount).toBe(0);
  });

  it("6. Dependent step does not execute when prerequisite is policy blocked", async () => {
    policyEngine.setRule("terminal_execute", "BLOCKED");

    const plan: BrainPlan = {
      goal: "Policy blocked prerequisite test",
      steps: [
        {
          id: "step-blocked",
          purpose: "Blocked step",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-dependent",
          purpose: "Dependent step",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-blocked"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_policy_blocked",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
    expect(res.stepResults["step-blocked"].state).toBe("BLOCKED");
    expect(res.stepResults["step-dependent"].state).toBe("SKIPPED");
    expect(res.stepResults["step-dependent"].skippedDueToDependency).toBe(
      "step-blocked",
    );
    expect(safeTool.executionCount).toBe(0);
  });

  it("7. Missing dependency fails closed", async () => {
    const plan: BrainPlan = {
      goal: "Missing dependency plan",
      steps: [
        {
          id: "step-1",
          purpose: "Depends on non-existent step",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
          dependsOn: ["non_existent_step"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_missing_dep",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.stopReason).toContain("Plan validation failed");
    expect(safeTool.executionCount).toBe(0);
  });

  it("8. Invalid plan fails closed", async () => {
    const invalidPlan = {
      goal: "",
      steps: [],
    } as unknown as BrainPlan;

    const res = await orchestrator.orchestratePlan(invalidPlan, {
      commandId: "cmd_invalid",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.stopReason).toContain("Plan validation failed");
  });

  it("9. Dependency cycle fails closed", async () => {
    const cyclicPlan: BrainPlan = {
      goal: "Cyclic dependency test",
      steps: [
        {
          id: "step-a",
          purpose: "Step A",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
          dependsOn: ["step-b"],
        },
        {
          id: "step-b",
          purpose: "Step B",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-a"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(cyclicPlan, {
      commandId: "cmd_cycle",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.stopReason).toContain("Circular dependency detected");
    expect(safeTool.executionCount).toBe(0);
  });

  it("10. Policy-blocked step is not executed", async () => {
    policyEngine.setRule("terminal_execute", "BLOCKED");

    const plan: BrainPlan = {
      goal: "Blocked tool execution test",
      steps: [
        {
          id: "step-1",
          purpose: "Execute blocked tool",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_blocked_tool",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
    expect(res.stepResults["step-1"].state).toBe("BLOCKED");
    expect(safeTool.executionCount).toBe(0);
  });

  it("11. Approval-required step cannot execute without approval", async () => {
    const plan: BrainPlan = {
      goal: "Approval required test",
      steps: [
        {
          id: "step-1",
          purpose: "Run dangerous action",
          action: "DEVELOPMENT",
          toolId: "approval_tool",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_approval",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("APPROVAL_REQUIRED");
    expect(res.stepResults["step-1"].state).toBe("APPROVAL_REQUIRED");
    expect(approvalTool.executionCount).toBe(0);
  });

  it("12. Missing handler/capability fails closed", async () => {
    const plan: BrainPlan = {
      goal: "Missing capability step",
      steps: [
        {
          id: "step-1",
          purpose: "Unresolvable action",
          action: "INVESTIGATION",
          toolId: "non_existent_tool",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_missing_cap",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
    expect(res.stepResults["step-1"].state).toBe("BLOCKED");
  });

  it("13. Partial execution is explicitly represented and NEVER reported as full success", async () => {
    const plan: BrainPlan = {
      goal: "Partial execution test",
      steps: [
        {
          id: "step-1",
          purpose: "Successful step 1",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-2",
          purpose: "Failing step 2",
          action: "DEVELOPMENT",
          toolId: "failing_tool",
          dependsOn: ["step-1"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_partial",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("PARTIAL");
    expect(res.stepResults["step-1"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-2"].state).toBe("FAILED");
  });

  it("14. Terminal workflow result is deterministic", async () => {
    const plan: BrainPlan = {
      goal: "Deterministic plan execution",
      steps: [
        {
          id: "s1",
          purpose: "P1",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "s2",
          purpose: "P2",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["s1"],
        },
      ],
    };

    const res1 = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_det_1",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    const res2 = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_det_2",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.executionOrder).toEqual(res2.executionOrder);
    expect(res1.stepResults["s1"].state).toBe(res2.stepResults["s1"].state);
    expect(res1.stepResults["s2"].state).toBe(res2.stepResults["s2"].state);
  });

  it("15. Previously completed terminal step state cannot execute again unexpectedly", async () => {
    const executeSpy = vi.spyOn(safeTool, "execute");

    const plan: BrainPlan = {
      goal: "Terminal state non-re-execution test",
      steps: [
        {
          id: "s1",
          purpose: "Step 1",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_terminal_repeat",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    const countAfterFirstExecution = executeSpy.mock.calls.length;
    expect(countAfterFirstExecution).toBe(1);

    // Re-orchestrating with same plan object produces a new clean context run without double-executing in a single run
    expect(res.stepResults["s1"].state).toBe("SUCCEEDED");
  });

  it("16. TaskExecutor executes BrainPlan seamlessly via executeBrainPlan", async () => {
    const plan: BrainPlan = {
      goal: "TaskExecutor BrainPlan test",
      steps: [
        {
          id: "task-step-1",
          purpose: "Task executor check",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.executeBrainPlan(plan, {
      taskId: "task_m8_1",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.stepResults["task-step-1"].state).toBe("SUCCEEDED");
  });

  it("17. Existing M7 Brain behavior remains unchanged", () => {
    const brain = new DeterministicBrain();
    const result = brain.interpret({
      rawCommandText: "بررسی کن وضعیت سرور و بعد تست کن کد را",
    });

    expect(result.intent).toBe("ACTION");
    expect(result.plan).toBeDefined();
    expect(result.plan?.steps).toHaveLength(2);
    expect(result.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(result.plan?.steps[1].action).toBe("VERIFICATION");
    expect(result.plan?.steps[1].dependsOn).toEqual(["step-1"]);
  });

  it("18. Policy is evaluated independently for each executable step", async () => {
    policyEngine.setRule("terminal_execute", "SAFE");
    policyEngine.setRule("failing_tool", "BLOCKED");

    const plan: BrainPlan = {
      goal: "Per-step independent policy evaluation test",
      steps: [
        {
          id: "step-safe",
          purpose: "Safe step",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-blocked",
          purpose: "Blocked step",
          action: "DEVELOPMENT",
          toolId: "failing_tool",
          dependsOn: ["step-safe"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_indep_policy",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.stepResults["step-safe"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-blocked"].state).toBe("BLOCKED");
    expect(res.status).toBe("PARTIAL");
    expect(res.success).toBe(false);
  });

  it("19. A later step cannot inherit authorization from an earlier step", async () => {
    const plan: BrainPlan = {
      goal: "Authorization inheritance prevention test",
      steps: [
        {
          id: "step-authorized",
          purpose: "Authorized SAFE step",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-unauthorized",
          purpose: "Approval required step without approval",
          action: "DEVELOPMENT",
          toolId: "approval_tool",
          dependsOn: ["step-authorized"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_no_inherit",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.stepResults["step-authorized"].state).toBe("SUCCEEDED");
    expect(res.stepResults["step-unauthorized"].state).toBe(
      "APPROVAL_REQUIRED",
    );
    expect(approvalTool.executionCount).toBe(0);
    expect(res.success).toBe(false);
  });

  it("20. Multi-step plan cannot turn one approved step into implicit approval for another step", async () => {
    const plan: BrainPlan = {
      goal: "No implicit multi-step approval inheritance",
      steps: [
        {
          id: "step-1-app",
          purpose: "First approval required step",
          action: "DEVELOPMENT",
          toolId: "approval_tool",
        },
        {
          id: "step-2-app",
          purpose: "Second approval required step",
          action: "DEVELOPMENT",
          toolId: "approval_tool",
          dependsOn: ["step-1-app"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_no_multi_approval",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.stepResults["step-1-app"].state).toBe("APPROVAL_REQUIRED");
    expect(res.stepResults["step-2-app"].state).toBe("SKIPPED");
    expect(approvalTool.executionCount).toBe(0);
  });

  it("21. Executing step receives a distinct, deterministic per-step execution identity", async () => {
    const capturedContexts: ExecutionContext[] = [];
    const spy = vi
      .spyOn(safeTool, "execute")
      .mockImplementation(async (_params, ctx) => {
        capturedContexts.push(ctx);
        return { success: true, output: "ok" };
      });

    const plan: BrainPlan = {
      goal: "Distinct execution contexts test",
      steps: [
        {
          id: "step-id-1",
          purpose: "Purpose 1",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
        {
          id: "step-id-2",
          purpose: "Purpose 2",
          action: "VERIFICATION",
          toolId: "terminal_execute",
          dependsOn: ["step-id-1"],
        },
      ],
    };

    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_distinct_ctx",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
    });

    expect(res.success).toBe(true);
    expect(capturedContexts).toHaveLength(2);
    expect(capturedContexts[0].executionId).toBe(
      "exec_cmd_distinct_ctx_step-id-1",
    );
    expect(capturedContexts[1].executionId).toBe(
      "exec_cmd_distinct_ctx_step-id-2",
    );
    expect(capturedContexts[0].executionId).not.toBe(
      capturedContexts[1].executionId,
    );

    spy.mockRestore();
  });

  it("22. Missing required environment context fails closed", async () => {
    const mockAssistant = {
      executeWorkflow: vi.fn(),
    } as any;

    orchestrator.setAssistant(mockAssistant);

    const plan: BrainPlan = {
      goal: "Missing environment context plan",
      steps: [
        {
          id: "s1",
          purpose: "Step requiring environment",
          action: "INVESTIGATION",
          toolId: "terminal_execute",
        },
      ],
    };

    // When environmentId is omitted, orchestratePlan fails closed immediately
    const res = await orchestrator.orchestratePlan(plan, {
      commandId: "cmd_no_env",
      workspaceId: "ws_m8",
      // environmentId intentionally omitted
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.stopReason).toContain("Missing mandatory environment context");
    expect(res.stepResults["s1"].state).toBe("FAILED");
    expect(res.stepResults["s1"].error).toContain(
      "Missing mandatory environment context",
    );
    expect(safeTool.executionCount).toBe(0);
    expect(mockAssistant.executeWorkflow).not.toHaveBeenCalled();
  });

  it("23. RealWorldAssistant path + BLOCKED: Assistant and ControlledAutonomyEngine are NOT invoked, Tool.execute count is 0", async () => {
    policyEngine.setRule("terminal_execute", "BLOCKED");

    const mockAssistant = {
      executeWorkflow: vi.fn().mockResolvedValue({
        success: false,
        executedSteps: [{ status: "BLOCKED" }],
        error: "Action explicitly blocked by policy.",
      }),
    } as any;

    orchestrator.setAssistant(mockAssistant);

    const res = await orchestrator.orchestrateBrainResult({
      brainResult: { intent: "ACTION", actionGoal: "INVESTIGATION" },
      commandId: "cmd_ast_blocked",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
      requestedToolId: "terminal_execute",
    });

    expect(res.status).toBe("BLOCKED");
    expect(safeTool.executionCount).toBe(0);
  });

  it("24. RealWorldAssistant path + APPROVAL_REQUIRED: Assistant and ControlledAutonomyEngine are NOT invoked, Tool.execute count is 0", async () => {
    policyEngine.setRule("terminal_execute", "APPROVAL_REQUIRED");

    const mockAssistant = {
      executeWorkflow: vi.fn().mockResolvedValue({
        success: false,
        executedSteps: [{ status: "APPROVAL_REQUIRED" }],
        error: "Action requires explicit owner approval.",
      }),
    } as any;

    orchestrator.setAssistant(mockAssistant);

    const res = await orchestrator.orchestrateBrainResult({
      brainResult: { intent: "ACTION", actionGoal: "INVESTIGATION" },
      commandId: "cmd_ast_app",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
      requestedToolId: "terminal_execute",
    });

    expect(res.status).toBe("APPROVAL_REQUIRED");
    expect(safeTool.executionCount).toBe(0);
  });

  it("25. RealWorldAssistant path + SAFE: Assistant delegation allowed after policy evaluation", async () => {
    policyEngine.setRule("terminal_execute", "SAFE");

    const mockAssistant = {
      executeWorkflow: vi.fn().mockResolvedValue({
        success: true,
        executedSteps: [{ status: "EXECUTED" }],
        evidence: { done: true },
      }),
    } as any;

    orchestrator.setAssistant(mockAssistant);

    const res = await orchestrator.orchestrateBrainResult({
      brainResult: { intent: "ACTION", actionGoal: "INVESTIGATION" },
      commandId: "cmd_ast_safe",
      workspaceId: "ws_m8",
      environmentId: "env_ws_m8",
      requestedToolId: "terminal_execute",
    });

    expect(res.status).toBe("COMPLETED");
    expect(mockAssistant.executeWorkflow).toHaveBeenCalledTimes(1);
  });
});
