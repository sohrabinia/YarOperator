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
} from "../src/index.js";

describe("YarOperator Phase 27: Controlled Autonomy Engine", () => {
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

  // --- SECTION 1: DECISION CLASSIFICATION ---
  describe("Decision Classification & Precedence", () => {
    it("1. safe read -> SAFE", async () => {
      policyEngine.setRule("git_read", "SAFE");
      const request: AutonomousActionRequest = {
        taskId: "task_read",
        workspaceId: "yartrader",
        toolId: "git_read",
        params: { path: "README.md" },
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["git_read"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("SAFE");
      expect(res.policyResult).toBe("SAFE");
    });

    it("2. authorized test -> SAFE", async () => {
      policyEngine.setRule("run_test", "SAFE");
      const request: AutonomousActionRequest = {
        taskId: "task_test",
        workspaceId: "yartrader",
        toolId: "run_test",
        params: {},
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["run_test"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("SAFE");
    });

    it("3. missing scope -> BLOCKED", async () => {
      policyEngine.setRule("git_read", "SAFE");
      const request: AutonomousActionRequest = {
        taskId: "task_read",
        workspaceId: "yartrader",
        toolId: "git_read",
        params: {},
      };
      const invalidScope = orchestrator.createExecutionScope({
        workspaceId: "OTHER_WORKSPACE", // Mismatch
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["git_read"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        invalidScope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.reason).toContain("workspace mismatch");
    });

    it("4. unknown / unclassified action -> BLOCKED (fail-closed)", async () => {
      // Tool not registered in policyEngine
      const request: AutonomousActionRequest = {
        taskId: "task_unknown",
        workspaceId: "yartrader",
        toolId: "unknown_tool",
        params: {},
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["unknown_tool"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.reason).toContain(
        "unclassified/ambiguous and defaults to BLOCKED",
      );
    });

    it("5. explicit policy deny -> BLOCKED", async () => {
      policyEngine.setRule("deploy_prod", "BLOCKED");
      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
        params: {},
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["deploy_prod"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.policyResult).toBe("BLOCKED");
    });

    it("6. approval-required without approval -> APPROVAL_REQUIRED", async () => {
      policyEngine.setRule("deploy_prod", "APPROVAL_REQUIRED");
      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
        params: { env: "prod" },
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["deploy_prod"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("APPROVAL_REQUIRED");
      expect(res.approvalRequired).toBe(true);
      expect(res.approvalFingerprint).toBeDefined();
    });

    it("7. valid approval proceeds to execution checks", async () => {
      policyEngine.setRule("deploy_prod", "APPROVAL_REQUIRED");
      const params = { env: "prod" };
      const req = approvalManager.requestApproval("deploy_prod", params);
      approvalManager.grantApproval(req.id, "m.a.sohrabimia@gmail.com");

      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
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
    });

    it("7b. consumed approval token replay attempt is rejected", async () => {
      policyEngine.setRule("deploy_prod", "APPROVAL_REQUIRED");
      const params = { env: "prod" };
      const req = approvalManager.requestApproval("deploy_prod", params);
      approvalManager.grantApproval(req.id, "m.a.sohrabimia@gmail.com");

      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
        params,
      };
      const budget1 = createBudget();

      // First run consumes the token successfully
      const res1 = await autonomyEngine.runControlledAction(
        request,
        budget1,
        mockContext,
      );
      expect(res1.success).toBe(true);

      // Second run with same consumed token MUST be rejected as APPROVAL_REQUIRED
      const budget2 = createBudget();
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["deploy_prod"],
      });

      const res2 = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res2.decision).toBe("APPROVAL_REQUIRED");
      expect(res2.reason).toContain("requires explicit owner approval");
    });
  });

  // --- SECTION 2: AUTHORITY SEPARATION & INVARIANTS ---
  describe("Authority Separation & Security Invariants", () => {
    it("8. owner preferences cannot grant authority for BLOCKED operations", async () => {
      ownerManager.updatePreferences({
        preferredAutonomyLevel: "FULL_AUTONOMOUS",
        riskTolerance: "HIGH",
      });
      policyEngine.setRule("deploy_prod", "BLOCKED");

      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
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
    });

    it("9. provider identity cannot grant authority", async () => {
      agentRegistry.registerAgent({
        id: "claude_agent",
        name: "Claude Agent",
        capabilities: ["software-development"],
        workspaceScopes: ["yartrader"],
        toolScopes: ["deploy_prod"],
        provider: "AnthropicProvider",
        model: "claude-3-5",
        contract: { inputSchema: {}, outputSchema: {} },
        available: true,
      });

      policyEngine.setRule("deploy_prod", "BLOCKED");

      const request: AutonomousActionRequest = {
        taskId: "task_deploy",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
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
    });

    it("10. autonomy cannot bypass Tool Authorization", async () => {
      policyEngine.setRule("unauthorized_tool", "SAFE");
      // Tool not in agent's allowed tool scopes/ExecutionScope

      const request: AutonomousActionRequest = {
        taskId: "task_unauth",
        workspaceId: "yartrader",
        toolId: "unauthorized_tool",
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
      expect(res.error).toContain("is not authorized");
    });
  });

  // --- SECTION 3: ISOLATION & BOUNDARIES ---
  describe("Isolation Boundaries", () => {
    it("11. cross-workspace execution -> BLOCKED", async () => {
      policyEngine.setRule("git_read", "SAFE");

      const request: AutonomousActionRequest = {
        taskId: "task_cross",
        workspaceId: "amlakbashi", // Cross workspace
        toolId: "git_read",
        params: {},
      };
      const budget = createBudget();

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.state).toBe("ESCALATED");
      expect(res.error).toContain("Agent selection failed.");
    });
  });

  // --- SECTION 4: BUDGET & RETRIES ---
  describe("Autonomy Budget & Retries", () => {
    it("12. action budget exhaustion stops execution and escalates", async () => {
      policyEngine.setRule("git_read", "SAFE");
      const request: AutonomousActionRequest = {
        taskId: "task_budget",
        workspaceId: "yartrader",
        toolId: "git_read",
        params: {},
      };
      const budget = createBudget({ maxActions: 1, usedActions: 1 }); // Exhausted

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.state).toBe("ESCALATED");
      expect(res.error).toContain("Action budget exhausted.");
    });

    it("13. BLOCKED operations cannot be retried to gain permission", async () => {
      policyEngine.setRule("deploy_prod", "BLOCKED");
      const request: AutonomousActionRequest = {
        taskId: "task_blocked_retry",
        workspaceId: "yartrader",
        toolId: "deploy_prod",
        params: {},
      };
      const budget = createBudget({ maxRetries: 3 });

      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.state).toBe("BLOCKED");
      expect(budget.usedRetries).toBe(0); // No retries attempted for BLOCKED
    });
  });

  // --- SECTION 5: STATE MACHINE VALIDATION ---
  describe("State Machine Validation", () => {
    it("14. invalid state transitions fail validation", () => {
      expect(
        autonomyEngine.validateStateTransition("BLOCKED", "EXECUTING"),
      ).toBe(false);
      expect(
        autonomyEngine.validateStateTransition("FAILED", "EXECUTING"),
      ).toBe(false);
      expect(
        autonomyEngine.validateStateTransition("COMPLETED", "EXECUTING"),
      ).toBe(false);
      expect(
        autonomyEngine.validateStateTransition("CREATED", "EXECUTING"),
      ).toBe(false);
    });

    it("15. valid state transitions pass validation", () => {
      expect(autonomyEngine.validateStateTransition("CREATED", "PLANNED")).toBe(
        true,
      );
      expect(
        autonomyEngine.validateStateTransition("PLANNED", "EVALUATING"),
      ).toBe(true);
      expect(autonomyEngine.validateStateTransition("EVALUATING", "SAFE")).toBe(
        true,
      );
      expect(autonomyEngine.validateStateTransition("SAFE", "EXECUTING")).toBe(
        true,
      );
      expect(
        autonomyEngine.validateStateTransition("EXECUTING", "VALIDATING"),
      ).toBe(true);
      expect(
        autonomyEngine.validateStateTransition("VALIDATING", "COMPLETED"),
      ).toBe(true);
    });
  });

  // --- SECTION 6: SELF-MODIFICATION PROTECTION ---
  describe("Self-Modification Protections", () => {
    it("16. attempts to modify PolicyEngine rules autonomously are BLOCKED", async () => {
      const request: AutonomousActionRequest = {
        taskId: "task_self_mod",
        workspaceId: "yartrader",
        toolId: "PolicyEngine_modify_rule",
        params: {},
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["PolicyEngine_modify_rule"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.reason).toContain("Attempt to modify security boundary");
    });

    it("17. explicit security critical self-modification flag is BLOCKED", async () => {
      const request: AutonomousActionRequest = {
        taskId: "task_self_mod_flag",
        workspaceId: "yartrader",
        toolId: "git_read",
        params: {},
        isSecurityCriticalModification: true,
      };
      const scope = orchestrator.createExecutionScope({
        workspaceId: "yartrader",
        agentId: "jules_autonomy_agent",
        capabilities: ["software-development"],
        tools: ["git_read"],
      });

      const res = autonomyEngine.evaluateAutonomyDecision(
        request,
        scope,
        mockContext,
      );
      expect(res.decision).toBe("BLOCKED");
      expect(res.reason).toContain(
        "Autonomous self-modification of security infrastructure or policy boundary is explicitly BLOCKED.",
      );
    });
  });

  // --- SECTION 7: PHASE 26 INTEGRATION DEMONSTRATION ---
  describe("Phase 26 + Phase 27 Integration Demonstration", () => {
    it("18. controlled autonomous demonstration task executes cleanly", async () => {
      policyEngine.setRule("git_read", "SAFE");

      const request: AutonomousActionRequest = {
        taskId: "phase27_demo_task",
        workspaceId: "yartrader",
        repository: "sohrabinia/YarOperator",
        toolId: "git_read",
        params: { path: "README.md" },
        capability: "software-development",
        acceptanceCriteria: { requiredRoutes: ["/"] },
        actualRoutes: ["/"],
      };

      const budget = createBudget();
      const res = await autonomyEngine.runControlledAction(
        request,
        budget,
        mockContext,
      );

      expect(res.success).toBe(true);
      expect(res.state).toBe("COMPLETED");
      expect(res.evidence?.taskId).toBe("phase27_demo_task");
      expect(res.evidence?.provider).toBe("JulesProvider");

      const auditEvents = await auditManager.queryEvents({
        workspaceId: "yartrader",
      });
      expect(auditEvents.length).toBeGreaterThan(0);

      const notifications = notificationManager.listNotifications({
        workspaceId: "yartrader",
      });
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].type).toBe("TASK_COMPLETED");
    });
  });
});
