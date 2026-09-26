import { describe, it, expect, beforeEach, vi } from "vitest";
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
  SystemHealthProvider,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { TerminalTool } from "../src/core/terminal/index.js";
import { GitTool } from "../src/core/git/index.js";
import { BrowserTool } from "../src/core/browser/index.js";
import { WebResearchTool } from "../src/core/research/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";

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

  beforeEach(async () => {
    vi.restoreAllMocks();
    apiHandler = await bootstrapOperatorApplication({
      bearerToken,
      ownerId: "owner_sohrab",
      defaultWorkspaceId: "yartrader",
      useInMemoryStores: true,
      resourcesPath: "config/resources.example.json",
    });
  });

  describe("1. Real Task Execution Path & Safe Health/Readiness Resolution", () => {
    it("exact real YarTrader task prompt reaches POST /api/v1/operator/chat and ACTUALLY executes OperatorHealthTool.execute()", async () => {
      const realTaskPrompt =
        "Check operator runtime health and report current readiness status. Do not perform any trading or external side effects.";

      const spyHealth = vi.spyOn(OperatorHealthTool.prototype, "execute");
      const spyTerminal = vi.spyOn(TerminalTool.prototype, "execute");
      const spyGit = vi.spyOn(GitTool.prototype, "execute");
      const spyBrowser = vi.spyOn(BrowserTool.prototype, "execute");
      const spyResearch = vi.spyOn(WebResearchTool.prototype, "execute");

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

      // Prove OperatorHealthTool.execute() was ACTUALLY invoked
      expect(spyHealth).toHaveBeenCalledTimes(1);

      // Prove NO unrelated/mutating tools were executed
      expect(spyTerminal).not.toHaveBeenCalled();
      expect(spyGit).not.toHaveBeenCalled();
      expect(spyBrowser).not.toHaveBeenCalled();
      expect(spyResearch).not.toHaveBeenCalled();

      const details = res.body.result?.details as any;
      expect(details?.executedSteps?.[0]?.status).toBe("EXECUTED");
      expect(details?.executedSteps?.[0]?.toolId).toBe("operator_health");
    });

    it("readiness request resolves deterministically to operator_health tool and executes it", async () => {
      const spyHealth = vi.spyOn(OperatorHealthTool.prototype, "execute");

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
      expect(spyHealth).toHaveBeenCalledTimes(1);
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

  describe("2. Single Authoritative Source of Truth for Health & Readiness", () => {
    it("OperatorHealthTool and API endpoints (/health, /readiness) share 100% identical SystemHealthProvider report", async () => {
      const provider = apiHandler.getHealthProvider();
      expect(provider).toBeInstanceOf(SystemHealthProvider);

      const apiHealth = apiHandler.getHealth();
      const apiReadiness = apiHandler.getReadiness();

      const healthTool = new OperatorHealthTool(provider);
      const toolExec = await healthTool.execute(
        {},
        {
          executionId: "exec_auth_test",
          timestamp: new Date(),
        },
      );

      expect(toolExec.success).toBe(true);
      expect(toolExec.output?.health.status).toBe(
        apiHealth.body.health?.status,
      );
      expect(toolExec.output?.readiness.status).toBe(
        apiReadiness.body.readiness?.status,
      );
      expect(toolExec.output?.readiness.subsystems).toEqual(
        apiReadiness.body.readiness?.subsystems,
      );
    });

    it("if authoritative readiness becomes NOT_READY, both /readiness and OperatorHealthTool report NOT_READY/DEGRADED in sync", async () => {
      const mockIdentityStore = {
        checkIntegrity: () => false, // Unhealthy identity store
      };

      const failingProvider = new SystemHealthProvider(
        () => true,
        () => mockIdentityStore,
      );

      const failingApiHandler = new OperatorApiHandler(
        { receiveCommand: async () => ({ accepted: true }) } as any,
        undefined,
        mockIdentityStore as any,
        failingProvider,
      );

      const readinessRes = failingApiHandler.getReadiness();
      expect(readinessRes.statusCode).toBe(503);
      expect(readinessRes.body.readiness?.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness?.subsystems.identityStore).toBe(false);

      const healthTool = new OperatorHealthTool(failingProvider);
      const toolRes = await healthTool.execute(
        {},
        {
          executionId: "exec_failing_test",
          timestamp: new Date(),
        },
      );

      expect(toolRes.success).toBe(true);
      expect(toolRes.output?.readiness.status).toBe("NOT_READY");
      expect(toolRes.output?.health.status).toBe("DEGRADED");
    });
  });

  describe("3. Ambiguous Multi-Tool Safety Boundary (Fail-Closed)", () => {
    it("ambiguous multi-tool action without explicit requestedToolId remains BLOCKED with success=false", async () => {
      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "Check code changes in repository", // Ambiguous multi-tool action
        },
      };

      const res = await apiHandler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.result?.status).toBe("BLOCKED");
      expect(res.body.result?.details).toBeDefined();
      const details = res.body.result?.details as any;
      expect(details?.executedSteps?.[0]?.status).toBe("BLOCKED");
    });
  });

  describe("4. API Contract Status Semantics Verification", () => {
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
          rawCommandText: "check operator health",
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

  describe("5. Bounded Intent Classification Positive, Negative, Boundary & Mutation Test Matrix", () => {
    it("formal Persian positive health/readiness phrases match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("وضعیت سیستم را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت سامانه را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("سلامت سیستم را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("سلامت سامانه را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("آمادگی سیستم را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت سرویس را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("سلامت سرور را بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت اپراتور را بررسی کن")).toBe(true);
    });

    it("colloquial Persian positive health/readiness phrases match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("وضعیت سیستم رو بررسی کن")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت سیستم رو چک کن")).toBe(true);
      expect(isHealthReadinessIntent("وضعیت سیستم چطوره؟")).toBe(true);
      expect(isHealthReadinessIntent("سیستم چه وضعیتی داره؟")).toBe(true);
      expect(isHealthReadinessIntent("سیستم سالمه؟")).toBe(true);
      expect(isHealthReadinessIntent("آیا سیستم سالم است؟")).toBe(true);
      expect(isHealthReadinessIntent("سیستم آماده است؟")).toBe(true);
      expect(isHealthReadinessIntent("سرویس‌ها سالم هستند؟")).toBe(true);
      expect(isHealthReadinessIntent("لطفاً وضعیت سیستم را بررسی کن")).toBe(
        true,
      );
      expect(isHealthReadinessIntent("یه بررسی از وضعیت سیستم انجام بده")).toBe(
        true,
      );
      expect(isHealthReadinessIntent("وضعیت سرویس رو ببین")).toBe(true);
    });

    it("word-order, spacing, Unicode, and Arabic character variations match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("سیستم چه وضعیتی دارد؟")).toBe(true);
      expect(isHealthReadinessIntent("سیستم در چه وضعیتی است؟")).toBe(true);
      expect(isHealthReadinessIntent("از وضعیت سیستم بگو")).toBe(true);
      expect(isHealthReadinessIntent("سیستم را از نظر سلامت بررسی کن")).toBe(
        true,
      );
      // Arabic Kafka (ك) and Yaf (ي)
      expect(isHealthReadinessIntent("وضعيّت سيستم را بررسی كن")).toBe(true);
      // Half-space (ZWNJ) and zero-width spaces
      expect(isHealthReadinessIntent("وضعیت\u200Cسیستم را بررسی\u200Cکن")).toBe(
        true,
      );
      // Extra whitespace
      expect(
        isHealthReadinessIntent("   وضعیت    سیستم    را   بررسی  کن   "),
      ).toBe(true);
    });

    it("English positive health/readiness phrases match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("check system status")).toBe(true);
      expect(isHealthReadinessIntent("check system health")).toBe(true);
      expect(isHealthReadinessIntent("is the system ready")).toBe(true);
      expect(isHealthReadinessIntent("inspect runtime health")).toBe(true);
      expect(isHealthReadinessIntent("report service status")).toBe(true);
      expect(isHealthReadinessIntent("check server health")).toBe(true);
    });

    it("boundary compound words containing substrings do NOT cause false positive health or mutation blocks", () => {
      // Compound words containing "سیستم" or "سرویس" but with different meanings
      expect(isHealthReadinessIntent("رویکرد سیستماتیک داشته باش")).toBe(false);
      expect(isHealthReadinessIntent("سرویسکار فرستاده شد")).toBe(false);
      // Compound words containing "روشن" or "راه" but not mutation (target noun absent -> fails)
      expect(isHealthReadinessIntent("او یک روشنفکر است")).toBe(false);
    });

    it("non-health investigation requests fail closed and do NOT resolve to health checks", () => {
      expect(isHealthReadinessIntent("سیستم را تحلیل کن")).toBe(false);
      expect(isHealthReadinessIntent("سیستم را توضیح بده")).toBe(false);
      expect(isHealthReadinessIntent("explain the system")).toBe(false);
      expect(isHealthReadinessIntent("analyze the service")).toBe(false);
    });

    it("negative domain protection phrases fail closed and do not match isHealthReadinessIntent", () => {
      expect(isHealthReadinessIntent("وضعیت پروژه را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت معامله را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت معاملات را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت بازار را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت داده‌ها را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("سلامت داده‌های بازار را بررسی کن")).toBe(
        false,
      );
      expect(isHealthReadinessIntent("وضعیت فایل‌ها را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت Git را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت گیت‌هاب را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت وب‌سایت را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت دیتابیس را بررسی کن")).toBe(false);
      expect(isHealthReadinessIntent("check git status")).toBe(false);
      expect(isHealthReadinessIntent("verify test results")).toBe(false);
      expect(isHealthReadinessIntent("run build")).toBe(false);
      expect(isHealthReadinessIntent("check logs for errors")).toBe(false);
      expect(isHealthReadinessIntent("check code in repo")).toBe(false);
      expect(isHealthReadinessIntent("check pr status")).toBe(false);
    });

    it("mutation commands fail closed and do NOT resolve to read-only health checks", () => {
      expect(isHealthReadinessIntent("سرویس را ریستارت کن")).toBe(false);
      expect(isHealthReadinessIntent("سرویس را متوقف کن")).toBe(false);
      expect(isHealthReadinessIntent("سیستم را خاموش کن")).toBe(false);
      expect(isHealthReadinessIntent("سیستم را روشن کن")).toBe(false);
      expect(isHealthReadinessIntent("سرور را تغییر بده")).toBe(false);
      expect(isHealthReadinessIntent("restart the service")).toBe(false);
      expect(isHealthReadinessIntent("stop the server")).toBe(false);
    });

    it("broad generic words without operational target nouns fail closed as false positives", () => {
      expect(isHealthReadinessIntent("سیستم است")).toBe(false);
      expect(isHealthReadinessIntent("سیستم دارد")).toBe(false);
      expect(isHealthReadinessIntent("انجام بده")).toBe(false);
      expect(isHealthReadinessIntent("ببین")).toBe(false);
      expect(isHealthReadinessIntent("چیست")).toBe(false);
      expect(isHealthReadinessIntent("health")).toBe(false);
      expect(isHealthReadinessIntent("readiness")).toBe(false);
      expect(isHealthReadinessIntent("status")).toBe(false);
      expect(isHealthReadinessIntent("وضعیت")).toBe(false);
    });

    it("end-to-end trace: exact production request 'وضعیت سیستم را بررسی کن' resolves to system-monitoring -> operator_health -> check -> SAFE -> COMPLETED", async () => {
      const spyHealth = vi.spyOn(OperatorHealthTool.prototype, "execute");

      const req: OperatorApiRequest = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: {
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
          rawCommandText: "وضعیت سیستم را بررسی کن",
        },
      };

      const res = await apiHandler.handleChatRequest(req);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result?.status).toBe("COMPLETED");
      expect(res.body.result?.resolvedCapability).toBe("system-monitoring");
      expect(res.body.result?.resolvedToolId).toBe("operator_health");
      expect(spyHealth).toHaveBeenCalledTimes(1);
    });
  });
});
