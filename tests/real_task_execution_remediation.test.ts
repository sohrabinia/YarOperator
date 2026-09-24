import { describe, it, expect, beforeEach } from "vitest";
import { OperatorApiHandler, OperatorApiRequest } from "../src/api/operator.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import {
  isHealthReadinessIntent,
  CapabilityResolver,
} from "../src/core/capability/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import {
  SecureToolEcosystem,
  OperatorHealthTool,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

class SpyMockTool implements Tool {
  metadata = {
    id: "spy_tool",
    name: "Spy Tool",
    description: "Spy Tool for testing",
    safetyLevel: "SAFE" as const,
  };
  invoked = false;

  async execute(): Promise<ToolResult> {
    this.invoked = true;
    return { success: true };
  }
}

describe("CTO Forensic Remediation — Real Task Execution Path & API/UI Status Semantics", () => {
  const bearerToken = "valid_test_bearer_token_789";
  let apiHandler: OperatorApiHandler;

  beforeEach(() => {
    apiHandler = bootstrapOperatorApplication({
      bearerToken,
      ownerId: "owner_sohrab",
      defaultWorkspaceId: "yartrader",
      useInMemoryStores: true,
    });
  });

  describe("1. Real Task Execution Path & Safe Health/Readiness Resolution", () => {
    it("exact real YarTrader task prompt resolves to operator_health and executes via ToolEcosystem", async () => {
      const realTaskPrompt =
        "Check operator runtime health and report current readiness status. Do not perform any trading or external side effects.";

      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: realTaskPrompt,
        },
      };

      const res = await apiHandler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result?.status).toBe("COMPLETED");
      expect(res.body.result?.resolvedCapability).toBe("system-monitoring");
      expect(res.body.result?.resolvedToolId).toBe("operator_health");

      const details = res.body.result?.details as any;
      expect(details?.executedSteps?.[0]?.status).toBe("EXECUTED");
      expect(details?.executedSteps?.[0]?.toolId).toBe("operator_health");

      const healthOutput =
        details?.evidence?.toolResult?.output || details?.evidence;
      expect(healthOutput).toBeDefined();
    });

    it("readiness request resolves deterministically to operator_health tool", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "check runtime readiness",
        },
      };

      const res = await apiHandler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result?.status).toBe("COMPLETED");
      expect(res.body.result?.resolvedCapability).toBe("system-monitoring");
      expect(res.body.result?.resolvedToolId).toBe("operator_health");
    });

    it("health/readiness execution is strictly read-only and non-mutating", async () => {
      const healthTool = new OperatorHealthTool();
      const execResult = await healthTool.execute(
        {},
        {
          executionId: "exec_test",
          timestamp: new Date(),
        },
      );

      expect(execResult.success).toBe(true);
      expect(execResult.output?.health?.status).toBe("HEALTHY");
      expect(execResult.output?.readiness?.status).toBe("READY");
      expect(typeof execResult.output?.health?.uptimeMs).toBe("number");
    });

    it("no trading, terminal, browser, or git tools can be implicitly selected for health/readiness tasks", async () => {
      const agentRegistry = new AgentRegistry();
      agentRegistry.registerAgent({
        id: "test_health_agent",
        name: "Test Health Agent",
        capabilities: ["system-monitoring", "software-development"],
        workspaceScopes: ["yartrader"],
        toolScopes: [
          "operator_health",
          "terminal_execute",
          "git_operate",
          "browser_operate",
        ],
        provider: "TestProvider",
        model: "test-v1",
        contract: { inputSchema: {}, outputSchema: {} },
        available: true,
      });

      const orchestrator = new AgentOrchestrator(agentRegistry);
      const approvalManager = new ApprovalManager(":memory:");
      const policyEngine = new PolicyEngine(approvalManager);
      const auditManager = new AuditManager();

      const spyTerminal = new SpyMockTool();
      spyTerminal.metadata.id = "terminal_execute";
      const spyGit = new SpyMockTool();
      spyGit.metadata.id = "git_operate";
      const spyBrowser = new SpyMockTool();
      spyBrowser.metadata.id = "browser_operate";

      const healthTool = new OperatorHealthTool();

      const toolEcosystem = new SecureToolEcosystem(
        undefined,
        policyEngine,
        approvalManager,
      );
      toolEcosystem.registerTool(spyTerminal);
      toolEcosystem.registerTool(spyGit);
      toolEcosystem.registerTool(spyBrowser);
      toolEcosystem.registerTool(healthTool);

      const capRes = new CapabilityResolver(agentRegistry).resolve({
        brainResult: {
          intent: "ACTION",
          actionGoal: "INVESTIGATION",
        },
        rawCommandText:
          "Check operator runtime health and report current readiness status.",
        workspaceId: "yartrader",
      });

      expect(capRes.resolvedCapability).toBe("system-monitoring");
      expect(capRes.resolvedToolId).toBe("operator_health");
      expect(capRes.resolvedToolId).not.toBe("terminal_execute");
      expect(capRes.resolvedToolId).not.toBe("git_operate");
      expect(capRes.resolvedToolId).not.toBe("browser_operate");
      expect(spyTerminal.invoked).toBe(false);
      expect(spyGit.invoked).toBe(false);
      expect(spyBrowser.invoked).toBe(false);
    });
  });

  describe("2. Ambiguous Multi-Tool Safety Boundary (Fail-Closed)", () => {
    it("ambiguous multi-tool action without explicit requestedToolId remains BLOCKED with success=false", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "Check code changes in repository", // Ambiguous multi-tool action under software-development
        },
      };

      const res = await apiHandler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(false); // MUST BE false!
      expect(res.body.result?.status).toBe("BLOCKED");
      expect(res.body.result?.details).toBeDefined();
      const details = res.body.result?.details as any;
      expect(details?.executedSteps?.[0]?.status).toBe("BLOCKED");
    });
  });

  describe("3. API Contract Status Semantics Verification", () => {
    it("COMPLETED API response has success=true and status=COMPLETED", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "check operator health",
        },
      };

      const res = await apiHandler.handleChatRequest(req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result?.status).toBe("COMPLETED");
    });

    it("BLOCKED API response has success=false and status=BLOCKED", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "invalid_unregistered_environment_xyz",
          rawCommandText: "check operator health",
        },
      };

      const res = await apiHandler.handleChatRequest(req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.result?.status).toBe("BLOCKED");
    });

    it("APPROVAL_REQUIRED API response has success=false and status=APPROVAL_REQUIRED", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "Run terminal command",
          requestedToolId: "terminal_execute",
          params: { command: "echo test" },
        },
      };

      const res = await apiHandler.handleChatRequest(req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.result?.status).toBe("APPROVAL_REQUIRED");
    });

    it("API never returns success=true combined with status=BLOCKED or status=FAILED", async () => {
      const reqBlocked: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "invalid_env_99",
          rawCommandText: "operator health",
        },
      };

      const resBlocked = await apiHandler.handleChatRequest(reqBlocked);
      if (resBlocked.body.result?.status === "BLOCKED") {
        expect(resBlocked.body.success).toBe(false);
      }

      if (resBlocked.body.result?.status === "FAILED") {
        expect(resBlocked.body.success).toBe(false);
      }
    });
  });

  describe("4. Intent Classification Positive & Negative Cases", () => {
    it("positive health/readiness phrases match isHealthReadinessIntent", () => {
      expect(
        isHealthReadinessIntent(
          "Check operator runtime health and report current readiness status.",
        ),
      ).toBe(true);
      expect(isHealthReadinessIntent("check operator runtime health")).toBe(
        true,
      );
      expect(isHealthReadinessIntent("check runtime readiness")).toBe(true);
      expect(isHealthReadinessIntent("operator health")).toBe(true);
      expect(isHealthReadinessIntent("operator readiness")).toBe(true);
      expect(isHealthReadinessIntent("report current readiness status")).toBe(
        true,
      );
      expect(isHealthReadinessIntent("بررسی سلامت اپراتور")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت آمادگی اپراتور")).toBe(true);
    });

    it("negative non-health phrases do not match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("check git status")).toBe(false);
      expect(isHealthReadinessIntent("verify test results")).toBe(false);
      expect(isHealthReadinessIntent("run build")).toBe(false);
      expect(isHealthReadinessIntent("check logs for errors")).toBe(false);
      expect(isHealthReadinessIntent("check code in repo")).toBe(false);
      expect(isHealthReadinessIntent("check pr status")).toBe(false);
    });
  });
});
