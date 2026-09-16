import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine } from "../src/core/policy/index.js";
import { ToolRegistry } from "../src/core/registry/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { TaskExecutor, TaskPlan } from "../src/core/task/index.js";
import {
  Tool,
  ToolResult,
  ExecutionContext,
} from "../src/core/contracts/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";

class DummyTool implements Tool {
  public metadata = {
    id: "terminal_execute",
    name: "Terminal Exec",
    description: "Executes terminal commands",
    safetyLevel: "SAFE" as const,
  };

  async execute(
    _params: unknown,
    _context: ExecutionContext,
  ): Promise<ToolResult> {
    return {
      success: true,
      output: { routes: ["/api/health", "/api/v1"] },
    };
  }
}

class UnsafeTool implements Tool {
  public metadata = {
    id: "dangerous_tool",
    name: "Dangerous Tool",
    description: "Dangerous operation",
    safetyLevel: "APPROVAL_REQUIRED" as const,
  };

  async execute(
    _params: unknown,
    _context: ExecutionContext,
  ): Promise<ToolResult> {
    return { success: true, output: "done" };
  }
}

describe("M4 Task Executor", () => {
  let agentRegistry: AgentRegistry;
  let policyEngine: PolicyEngine;
  let toolRegistry: ToolRegistry;
  let toolEcosystem: SecureToolEcosystem;
  let orchestrator: AgentOrchestrator;
  let taskExecutor: TaskExecutor;
  let envManager: EnvironmentManager;

  beforeEach(() => {
    agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent({
      id: "test_agent",
      name: "Test Agent",
      role: "test",
      capabilities: ["terminal-execution", "software-development"],
      workspaceScopes: ["ws_default"],
      toolScopes: ["terminal_execute", "dangerous_tool"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    policyEngine = new PolicyEngine();
    policyEngine.setRule("terminal_execute", "SAFE");
    policyEngine.setRule("dangerous_tool", "APPROVAL_REQUIRED");

    toolRegistry = new ToolRegistry();
    toolRegistry.register(new DummyTool());
    toolRegistry.register(new UnsafeTool());

    envManager = new EnvironmentManager();
    envManager.registerEnvironment({
      id: "env_default",
      name: "Default Environment",
      type: "DEVELOPMENT",
      capabilities: ["terminal_execute", "dangerous_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "ws_default" },
    });

    const wsPolicyManager = new WorkspacePolicyManager();
    wsPolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "ws_default",
        allowedTools: ["terminal_execute", "dangerous_tool"],
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

  it("1. validates task contract creation and planning", () => {
    const invalidPlan: TaskPlan = {
      id: "",
      name: "",
      steps: [],
    };
    const check = taskExecutor.plan(invalidPlan);
    expect(check.valid).toBe(false);
    expect(check.error).toBeDefined();
  });

  it("2. executes single-step task successfully", async () => {
    const plan: TaskPlan = {
      id: "task_single",
      name: "Single Step Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.stepResults["step_1"].status).toBe("COMPLETED");
  });

  it("3. executes multi-step task in deterministic dependency order", async () => {
    const plan: TaskPlan = {
      id: "task_multi",
      name: "Multi Step Task",
      steps: [
        {
          id: "step_2",
          commandId: "cmd_2",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
          dependsOn: ["step_1"],
        },
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(true);
    expect(Object.keys(res.stepResults)).toEqual(["step_1", "step_2"]);
  });

  it("4. rejects cyclic dependency task plans before execution", async () => {
    const cyclicPlan: TaskPlan = {
      id: "task_cycle",
      name: "Cyclic Task",
      steps: [
        {
          id: "step_a",
          commandId: "cmd_a",
          workspaceId: "ws_default",
          brainResult: { intent: "ACTION" },
          dependsOn: ["step_b"],
        },
        {
          id: "step_b",
          commandId: "cmd_b",
          workspaceId: "ws_default",
          brainResult: { intent: "ACTION" },
          dependsOn: ["step_a"],
        },
      ],
    };

    const check = taskExecutor.plan(cyclicPlan);
    expect(check.valid).toBe(false);
    expect(check.error).toContain("Cyclic dependency");

    const res = await taskExecutor.execute(cyclicPlan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("FAILED");
  });

  it("5. fails closed when capability resolution fails", async () => {
    const plan: TaskPlan = {
      id: "task_unresolved",
      name: "Unresolved Capability Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          brainResult: { intent: "ACTION" },
          targetCapability: "non_existent_capability",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
  });

  it("6. fails closed on Policy BLOCKED tool execution", async () => {
    policyEngine.setRule("terminal_execute", "BLOCKED");

    const plan: TaskPlan = {
      id: "task_blocked",
      name: "Blocked Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
  });

  it("7. preserves APPROVAL_REQUIRED policy contract", async () => {
    const plan: TaskPlan = {
      id: "task_approval",
      name: "Approval Required Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "dangerous_tool",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("APPROVAL_REQUIRED");
  });

  it("8. evaluates acceptance criteria verification", async () => {
    const plan: TaskPlan = {
      id: "task_verify",
      name: "Task Verification Test",
      acceptanceCriteria: {
        requiredRoutes: ["/api/health"],
      },
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(true);
    expect(res.verificationPassed).toBe(true);
  });

  it("9. fails task when verification fails", async () => {
    const plan: TaskPlan = {
      id: "task_verify_failed",
      name: "Task Verification Fail Test",
      acceptanceCriteria: {
        requiredRoutes: ["/non_existent_route"],
      },
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          environmentId: "env_default",
          brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
          targetCapability: "terminal-execution",
          requestedToolId: "terminal_execute",
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("VERIFICATION_FAILED");
    expect(res.verificationPassed).toBe(false);
  });

  it("10. preserves conversation intent boundary", async () => {
    const plan: TaskPlan = {
      id: "task_conv",
      name: "Conversation Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          brainResult: { intent: "CONVERSATION", reply: "Hello!" },
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(true);
    expect(res.status).toBe("COMPLETED");
    expect(res.stepResults["step_1"].reply).toBe("Hello!");
  });

  it("11. preserves ambiguous intent boundary", async () => {
    const plan: TaskPlan = {
      id: "task_ambiguous",
      name: "Ambiguous Task",
      steps: [
        {
          id: "step_1",
          commandId: "cmd_1",
          workspaceId: "ws_default",
          brainResult: { intent: "AMBIGUOUS", reason: "Unclear" },
        },
      ],
    };

    const res = await taskExecutor.execute(plan);
    expect(res.success).toBe(false);
    expect(res.status).toBe("BLOCKED");
  });
});
