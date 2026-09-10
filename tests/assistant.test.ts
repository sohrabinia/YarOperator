import { describe, it, expect, beforeEach } from "vitest";
import {
  RealWorldAssistant,
  AssistantGoal,
} from "../src/core/assistant/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { ControlledAutonomyEngine } from "../src/core/autonomy/index.js";
import {
  SecureToolEcosystem,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

class MockAssistantTool implements Tool {
  metadata = {
    id: "mock_assistant_tool",
    name: "Mock Assistant Tool",
    description: "Executes real world assistant goal",
    safetyLevel: "SAFE" as const,
  };
  invocations: any[] = [];

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push({ params, context });
    return {
      success: true,
      output: { executed: true, params },
    };
  }
}

describe("Phase 29 — Real World Assistant", () => {
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let toolEcosystem: SecureToolEcosystem;
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let autonomyEngine: ControlledAutonomyEngine;
  let assistant: RealWorldAssistant;
  let mockTool: MockAssistantTool;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    toolEcosystem = new SecureToolEcosystem();
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);

    mockTool = new MockAssistantTool();
    toolEcosystem.registerTool(mockTool);

    const environmentManager = new EnvironmentManager();
    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Env",
      type: "PRODUCTION",
      capabilities: ["mock_assistant_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      undefined,
      auditManager,
      notificationManager,
      undefined,
      environmentManager,
    );

    assistant = new RealWorldAssistant(
      orchestrator,
      policyEngine,
      autonomyEngine,
      auditManager,
      notificationManager,
    );

    agentRegistry.registerAgent({
      id: "jules_autonomy_agent",
      name: "Assistant Agent",
      capabilities: ["software-development", "web-automation"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["mock_assistant_tool"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    mockContext = {
      executionId: "exec_ast_1",
      timestamp: new Date(),
    };
  });

  it("1. SAFE goal executes tool successfully and logs audit & notification", async () => {
    policyEngine.setRule("mock_assistant_tool", "SAFE");

    const goal: AssistantGoal = {
      id: "goal_1",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      description: "Search web and summarize findings",
      targetCapability: "web-automation",
      requestedToolId: "mock_assistant_tool",
      params: { query: "YarOperator architecture" },
    };

    const result = await assistant.executeWorkflow(goal, mockContext);

    expect(result.success).toBe(true);
    expect(result.executedSteps[0].status).toBe("EXECUTED");
    expect(mockTool.invocations.length).toBe(1);

    const auditEvents = await auditManager.queryEvents({
      workspaceId: "yartrader",
      taskId: "goal_1",
    });
    expect(auditEvents.length).toBeGreaterThan(0);

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
      taskId: "goal_1",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("TASK_COMPLETED");
  });

  it("2. APPROVAL_REQUIRED goal refrains from executing tool and triggers notification", async () => {
    policyEngine.setRule("mock_assistant_tool", "APPROVAL_REQUIRED");

    const goal: AssistantGoal = {
      id: "goal_2",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      description: "Publish blog post to production site",
      targetCapability: "web-automation",
      requestedToolId: "mock_assistant_tool",
      params: { title: "New Release" },
      consequential: true,
    };

    const result = await assistant.executeWorkflow(goal, mockContext);

    expect(result.success).toBe(false);
    expect(result.executedSteps[0].status).toBe("APPROVAL_REQUIRED");
    expect(mockTool.invocations.length).toBe(0); // Tool NEVER executed

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
      taskId: "goal_2",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("APPROVAL_REQUIRED");
  });

  it("3. BLOCKED goal fails closed and never executes tool", async () => {
    policyEngine.setRule("mock_assistant_tool", "BLOCKED");

    const goal: AssistantGoal = {
      id: "goal_3",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      description: "Attempt prohibited action",
      targetCapability: "web-automation",
      requestedToolId: "mock_assistant_tool",
      params: {},
    };

    const result = await assistant.executeWorkflow(goal, mockContext);

    expect(result.success).toBe(false);
    expect(result.executedSteps[0].status).toBe("BLOCKED");
    expect(result.error).toContain("explicitly BLOCKED");
    expect(mockTool.invocations.length).toBe(0);
  });
});
