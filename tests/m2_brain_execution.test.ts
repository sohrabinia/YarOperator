import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import {
  SecureToolEcosystem,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import { OperatorApiRequest } from "../src/api/operator.js";

class SpyExecutionTool implements Tool {
  metadata = {
    id: "spy_exec_tool",
    name: "Spy Execution Tool",
    description: "Tool to test execution boundary routing",
    safetyLevel: "SAFE" as const,
  };

  invocations: Array<{ params: unknown; context: ExecutionContext }> = [];
  shouldFail = false;

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push({ params, context });
    if (this.shouldFail) {
      return {
        success: false,
        error: "Execution simulated failure in tool boundary.",
      };
    }
    return {
      success: true,
      output: { executed: true, params },
    };
  }
}

describe("M2: Brain → Existing Execution Pipeline", () => {
  const brain = new DeterministicBrain();

  // --- Brain Regression (1-3) ---
  describe("1-3. Brain Regression", () => {
    it("1. Greeting remains CONVERSATION", () => {
      const res = brain.interpret({ rawCommandText: "سلام" });
      expect(res.intent).toBe("CONVERSATION");
      expect(res.reply).toBeDefined();
    });

    it("2. Action request remains ACTION", () => {
      const res = brain.interpret({ rawCommandText: "یارتریدر رو بررسی کن" });
      expect(res.intent).toBe("ACTION");
    });

    it("3. Isolated entity remains AMBIGUOUS", () => {
      const res = brain.interpret({ rawCommandText: "یارتریدر" });
      expect(res.intent).toBe("AMBIGUOUS");
    });
  });

  // --- Orchestrator Routing & Policy Boundaries (4-9) ---
  describe("4-9. Orchestrator & Policy Enforcement", () => {
    let registry: AgentRegistry;
    let approvalManager: ApprovalManager;
    let policyEngine: PolicyEngine;
    let toolEcosystem: SecureToolEcosystem;
    let orchestrator: AgentOrchestrator;
    let spyTool: SpyExecutionTool;

    beforeEach(() => {
      registry = new AgentRegistry();
      approvalManager = new ApprovalManager();
      policyEngine = new PolicyEngine(approvalManager);
      toolEcosystem = new SecureToolEcosystem(
        undefined,
        policyEngine,
        approvalManager,
      );
      orchestrator = new AgentOrchestrator(
        registry,
        policyEngine,
        toolEcosystem,
      );

      spyTool = new SpyExecutionTool();
      toolEcosystem.registerTool(spyTool);

      registry.registerAgent({
        id: "test_agent",
        name: "Test Agent",
        capabilities: ["software-development"],
        workspaceScopes: ["yartrader"],
        toolScopes: ["spy_exec_tool"],
        provider: "TestProvider",
        model: "test-v1",
        contract: { inputSchema: {}, outputSchema: {} },
        available: true,
      });
    });

    it("4. CONVERSATION does not enter execution", async () => {
      const brainResult = brain.interpret({ rawCommandText: "سلام" });
      expect(brainResult.intent).toBe("CONVERSATION");

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_conv_1",
        workspaceId: "yartrader",
        rawCommandText: "سلام",
      });

      expect(orchResult.accepted).toBe(true);
      expect(orchResult.status).toBe("CONVERSATION");
      expect(orchResult.reply).toBeDefined();
      expect(spyTool.invocations.length).toBe(0); // Execution boundary NEVER reached
    });

    it("5. AMBIGUOUS does not enter execution", async () => {
      const brainResult = brain.interpret({ rawCommandText: "یارتریدر" });
      expect(brainResult.intent).toBe("AMBIGUOUS");

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_amb_1",
        workspaceId: "yartrader",
        rawCommandText: "یارتریدر",
      });

      expect(orchResult.accepted).toBe(false);
      expect(orchResult.status).toBe("AMBIGUOUS");
      expect(orchResult.reason).toBeDefined();
      expect(spyTool.invocations.length).toBe(0); // Execution boundary NEVER reached
    });

    it("6. Valid ACTION reaches Policy evaluation", async () => {
      policyEngine.setRule("spy_exec_tool", "SAFE");
      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const policySpy = vi.spyOn(policyEngine, "evaluate");

      await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_act_1",
        workspaceId: "yartrader",
        requestedToolId: "spy_exec_tool",
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(policySpy).toHaveBeenCalledWith(
        expect.objectContaining({ toolId: "spy_exec_tool" }),
      );
    });

    it("7. Blocked capability never reaches execution", async () => {
      policyEngine.setRule("spy_exec_tool", "BLOCKED");
      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_blocked_1",
        workspaceId: "yartrader",
        requestedToolId: "spy_exec_tool",
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(orchResult.accepted).toBe(false);
      expect(orchResult.status).toBe("BLOCKED");
      expect(orchResult.reason).toContain("explicitly BLOCKED");
      expect(spyTool.invocations.length).toBe(0); // Tool NEVER executed
    });

    it("8. Approval-required capability never executes without approval", async () => {
      policyEngine.setRule("spy_exec_tool", "APPROVAL_REQUIRED");
      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_app_1",
        workspaceId: "yartrader",
        requestedToolId: "spy_exec_tool",
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(orchResult.status).toBe("APPROVAL_REQUIRED");
      expect(spyTool.invocations.length).toBe(0); // Tool NEVER executed
    });

    it("9. Safe capability reaches existing execution boundary", async () => {
      policyEngine.setRule("spy_exec_tool", "SAFE");
      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_safe_1",
        workspaceId: "yartrader",
        requestedToolId: "spy_exec_tool",
        params: { mode: "investigate" },
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(orchResult.accepted).toBe(true);
      expect(orchResult.status).toBe("COMPLETED");
      expect(spyTool.invocations.length).toBe(1); // Real tool executed!
      expect(spyTool.invocations[0].params).toEqual({ mode: "investigate" });
    });
  });

  // --- Real Application Path Integration (10) ---
  describe("10. Integration Path Verification", () => {
    it("10. Real application path from HTTP API request -> Brain -> Orchestrator -> Policy -> Execution", async () => {
      const handler = bootstrapOperatorApplication({
        ownerId: "owner_sohrab",
        bearerToken: "token_m2_test",
        defaultWorkspaceId: "yartrader",
        useInMemoryStores: true,
      });

      const req: OperatorApiRequest = {
        headers: {
          authorization: "Bearer token_m2_test",
        },
        body: {
          commandId: "cmd_e2e_real_1",
          ownerId: "owner_sohrab",
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "Check git status of repository",
          requestedToolId: "git_operate",
          params: { action: "status" },
        },
      };

      const res = await handler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result).toBeDefined();
      expect(res.body.result?.status).toBe("COMPLETED");
      expect(res.body.result?.preservedCommandText).toBe(
        "Check git status of repository",
      );
      expect(res.body.result?.resolvedCapability).toBe("software-development");
      expect(res.body.result?.resolvedToolId).toBe("git_operate");
    });
  });

  // --- Failure Behavior (11-13) ---
  describe("11-13. Failure Behavior & Fail-Closed Boundaries", () => {
    let registry: AgentRegistry;
    let approvalManager: ApprovalManager;
    let policyEngine: PolicyEngine;
    let toolEcosystem: SecureToolEcosystem;
    let orchestrator: AgentOrchestrator;
    let spyTool: SpyExecutionTool;

    beforeEach(() => {
      registry = new AgentRegistry();
      approvalManager = new ApprovalManager();
      policyEngine = new PolicyEngine(approvalManager);
      toolEcosystem = new SecureToolEcosystem(
        undefined,
        policyEngine,
        approvalManager,
      );
      orchestrator = new AgentOrchestrator(
        registry,
        policyEngine,
        toolEcosystem,
      );

      spyTool = new SpyExecutionTool();
      toolEcosystem.registerTool(spyTool);

      registry.registerAgent({
        id: "test_agent",
        name: "Test Agent",
        capabilities: ["software-development"],
        workspaceScopes: ["yartrader"],
        toolScopes: ["spy_exec_tool"],
        provider: "TestProvider",
        model: "test-v1",
        contract: { inputSchema: {}, outputSchema: {} },
        available: true,
      });
    });

    it("11. Execution failure becomes a structured failure", async () => {
      policyEngine.setRule("spy_exec_tool", "SAFE");
      spyTool.shouldFail = true;

      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_fail_1",
        workspaceId: "yartrader",
        requestedToolId: "spy_exec_tool",
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(orchResult.accepted).toBe(false);
      expect(orchResult.status).toBe("FAILED");
      expect(orchResult.error).toContain("Execution simulated failure");
    });

    it("12. Unknown capability fails closed", async () => {
      const brainResult = brain.interpret({
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_unk_1",
        workspaceId: "yartrader",
        targetCapability: "non_existent_capability",
        rawCommandText: "یارتریدر رو بررسی کن",
      });

      expect(orchResult.accepted).toBe(false);
      expect(orchResult.status).toBe("BLOCKED");
      expect(orchResult.reason).toContain("No agent available");
    });

    it("13. Malformed/unsupported intent fails closed", async () => {
      const brainResult = brain.interpret({ rawCommandText: "    " });
      expect(brainResult.intent).toBe("AMBIGUOUS");

      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: "cmd_mal_1",
        workspaceId: "yartrader",
        rawCommandText: "    ",
      });

      expect(orchResult.accepted).toBe(false);
      expect(orchResult.status).toBe("AMBIGUOUS");
      expect(spyTool.invocations.length).toBe(0);
    });
  });
});
