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
  ControlledAutonomyEngine,
  AutonomyBudget,
  AutonomousActionRequest,
  ExecutionContext,
  OwnerManager,
  Tool,
  ToolResult,
} from "../src/index.js";

class MockExecutableTool implements Tool {
  public invocations: Array<{ params: unknown; context: ExecutionContext }> =
    [];
  public shouldFail = false;
  public failureErrorMessage = "Simulated tool execution failure";

  constructor(
    public metadata = {
      id: "mock_exec_tool",
      name: "Mock Executable Tool",
      description: "Test tool for verifying execution invocation",
      safetyLevel: "SAFE" as const,
    },
  ) {}

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push({ params, context });
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureErrorMessage,
      };
    }
    return {
      success: true,
      output: {
        executed: true,
        receivedParams: params,
        invocationCount: this.invocations.length,
      },
    };
  }
}

describe("YarOperator Phase 27: Controlled Autonomy Engine with Real Tool Execution", () => {
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let approvalManager: ApprovalManager;
  let policyEngine: PolicyEngine;
  let toolEcosystem: SecureToolEcosystem;
  let acceptanceEngine: AcceptanceEngine;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let ownerManager: OwnerManager;
  let autonomyEngine: ControlledAutonomyEngine;
  let mockTool: MockExecutableTool;

  const mockContext: ExecutionContext = {
    executionId: "autonomy_exec_1",
    timestamp: new Date(),
  };

  const createBudget = (
    overrides?: Partial<AutonomyBudget>,
  ): AutonomyBudget => ({
    maxActions: 5,
    maxRetries: 2,
    maxReplans: 2,
    usedActions: 0,
    usedRetries: 0,
    usedReplans: 0,
    ...overrides,
  });

  beforeEach(() => {
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    toolEcosystem = new SecureToolEcosystem();
    acceptanceEngine = new AcceptanceEngine();
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    ownerManager = new OwnerManager();

    mockTool = new MockExecutableTool();
    toolEcosystem.registerTool(mockTool);

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
    );

    // Register a valid dev agent
    agentRegistry.registerAgent({
      id: "jules_autonomy_agent",
      name: "Jules Autonomy Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: [
        "mock_exec_tool",
        "unregistered_tool_id",
        "git_read",
        "run_test",
        "run_build",
        "report_generate",
        "deploy_prod",
      ],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });
  });

  describe("Real Tool Execution & Invocations", () => {
    it("1. SAFE action actually invokes registered tool with exact params", async () => {
      policyEngine.setRule("mock_exec_tool", "SAFE");

      const params = { targetFile: "src/main.ts", mode: "compile" };
      const request: AutonomousActionRequest = {
        taskId: "task_real_exec",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params,
      };
      const budget = createBudget();

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );

      expect(res.success).toBe(true);
      expect(res.state).toBe("COMPLETED");
      expect(mockTool.invocations.length).toBe(1);
      expect(mockTool.invocations[0].params).toEqual(params);
      expect(res.evidence?.toolResult).toEqual({
        executed: true,
        receivedParams: params,
        invocationCount: 1,
      });
    });

    it("2. Tool execution failure triggers retry up to maxRetries", async () => {
      policyEngine.setRule("mock_exec_tool", "SAFE");
      mockTool.shouldFail = true; // Simulating tool execution error

      const request: AutonomousActionRequest = {
        taskId: "task_retry_fail",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: { test: 1 },
      };
      const budget = createBudget({ maxRetries: 2 });

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );

      expect(res.success).toBe(false);
      expect(res.state).toBe("FAILED");
      expect(mockTool.invocations.length).toBe(3); // Initial attempt (1) + 2 retries = 3
      expect(budget.usedRetries).toBe(2);
      expect(res.error).toContain("Tool execution failed after retries");
    });

    it("3. BLOCKED action NEVER invokes tool", async () => {
      policyEngine.setRule("mock_exec_tool", "BLOCKED");

      const request: AutonomousActionRequest = {
        taskId: "task_blocked_no_exec",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: {},
      };
      const budget = createBudget();

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );

      expect(res.success).toBe(false);
      expect(res.state).toBe("BLOCKED");
      expect(mockTool.invocations.length).toBe(0); // Tool NEVER invoked
    });

    it("4. APPROVAL_REQUIRED without approval NEVER invokes tool", async () => {
      policyEngine.setRule("mock_exec_tool", "APPROVAL_REQUIRED");

      const request: AutonomousActionRequest = {
        taskId: "task_app_no_exec",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: { key: "value" },
      };
      const budget = createBudget();

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );

      expect(res.success).toBe(false);
      expect(res.state).toBe("APPROVAL_REQUIRED");
      expect(mockTool.invocations.length).toBe(0); // Tool NEVER invoked
    });

    it("5. Consumed approval token cannot be replayed", async () => {
      policyEngine.setRule("mock_exec_tool", "APPROVAL_REQUIRED");
      const params = { action: "deploy" };
      const approvalReq = approvalManager.requestApproval(
        "mock_exec_tool",
        params,
      );
      approvalManager.grantApproval(approvalReq.id, "m.a.sohrabimia@gmail.com");

      const request: AutonomousActionRequest = {
        taskId: "task_approval_replay",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params,
      };

      // First run consumes token and invokes tool
      const res1 = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );
      expect(res1.success).toBe(true);
      expect(mockTool.invocations.length).toBe(1);

      // Second run attempts replay with consumed token
      const res2 = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );
      expect(res2.success).toBe(false);
      expect(res2.state).toBe("APPROVAL_REQUIRED");
      expect(mockTool.invocations.length).toBe(1); // Invocation count remains 1
    });

    it("6. Unauthorized tool in scope NEVER invokes tool", async () => {
      policyEngine.setRule("unauthorized_tool", "SAFE");
      const unauthTool = new MockExecutableTool({
        id: "unauthorized_tool",
        name: "Unauthorized Tool",
        description: "Not in agent toolScopes",
        safetyLevel: "SAFE",
      });
      toolEcosystem.registerTool(unauthTool);

      const request: AutonomousActionRequest = {
        taskId: "task_unauth_no_exec",
        workspaceId: "yartrader",
        toolId: "unauthorized_tool",
        params: {},
      };

      const res = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );

      expect(res.success).toBe(false);
      expect(res.state).toBe("BLOCKED");
      expect(unauthTool.invocations.length).toBe(0); // NEVER invoked
    });

    it("7. Audit log contains actual execution evidence and notifications reflect result", async () => {
      policyEngine.setRule("mock_exec_tool", "SAFE");

      const request: AutonomousActionRequest = {
        taskId: "task_audit_evidence",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: { testPayload: "sample" },
      };

      const res = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );
      expect(res.success).toBe(true);

      const auditEvents = await auditManager.queryEvents({
        workspaceId: "yartrader",
        taskId: "task_audit_evidence",
      });
      expect(auditEvents.length).toBeGreaterThan(0);
      const completedEvt = auditEvents.find(
        (e) => e.type === "ACTION_COMPLETED",
      );
      expect(completedEvt).toBeDefined();
      expect(completedEvt?.payload.evidence).toBeDefined();

      const notifications = notificationManager.listNotifications({
        workspaceId: "yartrader",
        taskId: "task_audit_evidence",
      });
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].type).toBe("TASK_COMPLETED");
    });

    it("8. Unregistered tool NEVER reports successful execution and fails closed", async () => {
      policyEngine.setRule("unregistered_tool_id", "SAFE");

      const request: AutonomousActionRequest = {
        taskId: "task_unregistered_fail",
        workspaceId: "yartrader",
        toolId: "unregistered_tool_id",
        params: { data: "test" },
      };

      const res = await autonomyEngine.runControlledAction(
        request,
        createBudget({ maxRetries: 0 }),
        mockContext,
      );

      expect(res.success).toBe(false);
      expect(res.state).toBe("FAILED");
      expect(res.error).toContain("is not registered in ToolRegistry");
      expect(res.evidence?.toolResult).toBeUndefined();

      const auditEvents = await auditManager.queryEvents({
        workspaceId: "yartrader",
        taskId: "task_unregistered_fail",
      });
      const failedEvt = auditEvents.find((e) => e.type === "ACTION_FAILED");
      expect(failedEvt).toBeDefined();
    });

    it("9. Acceptance criteria evaluation inspects actual tool execution evidence", async () => {
      policyEngine.setRule("mock_exec_tool", "SAFE");

      const request: AutonomousActionRequest = {
        taskId: "task_acceptance_evidence",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: { route: "/api/v1" },
        acceptanceCriteria: { requiredRoutes: ["/api/v1"] },
      };

      const res = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );

      expect(res.success).toBe(true);
      expect(res.state).toBe("COMPLETED");
      expect(res.evidence?.toolResult).toBeDefined();
    });
  });

  describe("Security Invariants & Decision Precedence", () => {
    it("10. Owner preferences cannot override BLOCKED policy decision", async () => {
      ownerManager.updatePreferences({
        preferredAutonomyLevel: "FULL_AUTONOMOUS",
        riskTolerance: "HIGH",
      });
      policyEngine.setRule("mock_exec_tool", "BLOCKED");

      const request: AutonomousActionRequest = {
        taskId: "task_pref_override",
        workspaceId: "yartrader",
        toolId: "mock_exec_tool",
        params: {},
      };

      const res = await autonomyEngine.runControlledAction(
        request,
        createBudget(),
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.state).toBe("BLOCKED");
      expect(mockTool.invocations.length).toBe(0);
    });

    it("11. Self-modification targeting PolicyEngine is explicitly BLOCKED", async () => {
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["PolicyEngine_modify_rules"],
      });

      const request: AutonomousActionRequest = {
        taskId: "task_self_mod",
        workspaceId: "yartrader",
        toolId: "PolicyEngine_modify_rules",
        params: {},
      };

      const res = await autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.reason).toContain("Attempt to modify security boundary");
    });
  });
});
