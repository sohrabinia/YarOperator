import { describe, it, expect, beforeEach } from "vitest";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import {
  SecureToolEcosystem,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
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

describe("M2: Brain → Existing Execution Architectural Pipeline", () => {
  const brain = new DeterministicBrain();
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

    const envManager = new EnvironmentManager();
    const wsPolicyManager = new WorkspacePolicyManager();

    wsPolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_exec_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    envManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Env",
      type: "PRODUCTION",
      capabilities: ["spy_exec_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    toolEcosystem = new SecureToolEcosystem(
      undefined,
      policyEngine,
      approvalManager,
      envManager,
      wsPolicyManager,
    );
    orchestrator = new AgentOrchestrator(registry, policyEngine, toolEcosystem);

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

  it("1. Brain CONVERSATION → no execution", async () => {
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
    expect(spyTool.invocations.length).toBe(0); // ZERO tool executions
  });

  it("2. Brain AMBIGUOUS → no execution", async () => {
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
    expect(spyTool.invocations.length).toBe(0); // ZERO tool executions
  });

  it("3. ACTION with explicit existing execution target → reaches existing execution boundary", async () => {
    policyEngine.setRule("spy_exec_tool", "SAFE");
    const brainResult = brain.interpret({
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    const orchResult = await orchestrator.orchestrateBrainResult({
      brainResult,
      commandId: "cmd_act_explicit",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      requestedToolId: "spy_exec_tool",
      params: { mode: "explicit_target" },
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(orchResult.accepted).toBe(true);
    expect(orchResult.status).toBe("COMPLETED");
    expect(spyTool.invocations.length).toBe(1);
    expect(spyTool.invocations[0].params).toEqual({ mode: "explicit_target" });
  });

  it("4. Policy BLOCKED → execution is not called", async () => {
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
    expect(spyTool.invocations.length).toBe(0); // NEVER called
  });

  it("5. Policy APPROVAL_REQUIRED → execution is not called unless authorized", async () => {
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

    expect(orchResult.accepted).toBe(true);
    expect(orchResult.status).toBe("APPROVAL_REQUIRED");
    expect(spyTool.invocations.length).toBe(0); // NEVER called without approval
  });

  it("6. Successful existing execution → COMPLETED", async () => {
    policyEngine.setRule("spy_exec_tool", "SAFE");
    const brainResult = brain.interpret({
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    const orchResult = await orchestrator.orchestrateBrainResult({
      brainResult,
      commandId: "cmd_comp_1",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      requestedToolId: "spy_exec_tool",
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(orchResult.accepted).toBe(true);
    expect(orchResult.status).toBe("COMPLETED");
  });

  it("7. Existing execution failure → FAILED", async () => {
    policyEngine.setRule("spy_exec_tool", "SAFE");
    spyTool.shouldFail = true;
    const brainResult = brain.interpret({
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    const orchResult = await orchestrator.orchestrateBrainResult({
      brainResult,
      commandId: "cmd_fail_1",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      requestedToolId: "spy_exec_tool",
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(orchResult.accepted).toBe(false);
    expect(orchResult.status).toBe("FAILED");
    expect(orchResult.error).toContain("Execution simulated failure");
  });

  it("8. No implicit tool selection from raw text (fails closed when no explicit tool provided)", async () => {
    // Multi-tool agent scope
    registry.registerAgent({
      id: "multi_agent",
      name: "Multi Tool Agent",
      capabilities: ["general-dev"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["tool_a", "tool_b"],
      provider: "TestProvider",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const brainResult = brain.interpret({
      rawCommandText: "وضعیت git را بررسی کن",
    });

    const orchResult = await orchestrator.orchestrateBrainResult({
      brainResult,
      commandId: "cmd_no_implicit",
      workspaceId: "yartrader",
      targetCapability: "general-dev",
      rawCommandText: "وضعیت git را بررسی کن",
    });

    expect(orchResult.accepted).toBe(false);
    expect(orchResult.status).toBe("BLOCKED");
    expect(orchResult.reason).toContain("No explicit tool provided");
    expect(spyTool.invocations.length).toBe(0);
  });

  it("9. No Git/terminal/status keyword routing (raw text keywords git/terminal/status do NOT trigger execution)", async () => {
    const rawTexts = [
      "git status",
      "terminal execute",
      "وضعیت ترمینال",
      "مخزن گیت",
    ];

    for (const text of rawTexts) {
      const brainResult = brain.interpret({ rawCommandText: text });
      const orchResult = await orchestrator.orchestrateBrainResult({
        brainResult,
        commandId: `cmd_keyword_${Date.now()}`,
        workspaceId: "yartrader",
        rawCommandText: text,
      });

      // Must fail closed as BLOCKED or AMBIGUOUS, NEVER executed
      expect(orchResult.status).not.toBe("COMPLETED");
      expect(spyTool.invocations.length).toBe(0);
    }
  });

  it("10. No capability inference inside Orchestrator (unregistered or unprovided capability fails closed)", async () => {
    const brainResult = brain.interpret({
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    const orchResult = await orchestrator.orchestrateBrainResult({
      brainResult,
      commandId: "cmd_no_capability_inference",
      workspaceId: "yartrader",
      targetCapability: "unregistered_capability_999",
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(orchResult.accepted).toBe(false);
    expect(orchResult.status).toBe("BLOCKED");
    expect(orchResult.reason).toContain("No agent available");
    expect(spyTool.invocations.length).toBe(0);
  });

  it("11. Real HTTP Application Path integration verification", async () => {
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
        commandId: "cmd_e2e_real_m2",
        ownerId: "owner_sohrab",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Check git status",
        requestedToolId: "git_operate",
        params: { action: "status" },
      },
    };

    const res = await handler.handleChatRequest(req);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result?.status).toBe("COMPLETED");
    expect(res.body.result?.resolvedToolId).toBe("git_operate");
  });
});
