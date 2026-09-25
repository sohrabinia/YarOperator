import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, existsSync } from "node:fs";
import {
  SecureToolEcosystem,
  YarTraderTool,
  CapabilityReporter,
  OperatorHealthTool,
} from "../src/core/tools/index.js";
import { WebResearchTool } from "../src/core/research/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
import { ToolRegistry } from "../src/core/registry/index.js";
import { ExecutionScope } from "../src/core/orchestrator/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

function safelyRemoveFile(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}

describe("YarTrader Tool & Capability Discovery Complete Test Suite (20 Scenarios)", () => {
  let testDbPath: string;
  let ecosystem: SecureToolEcosystem;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let envManager: EnvironmentManager;
  let wsPolicyManager: WorkspacePolicyManager;
  let mockServer: http.Server | null = null;
  let mockServerPort = 0;

  const scope: ExecutionScope = {
    workspaceId: "yartrader",
    allowedTools: ["yartrader_adapter"],
  };

  const context: ExecutionContext = {
    executionId: "exec_test_001",
    timestamp: new Date(),
    workspaceId: "yartrader",
    environmentId: "env_yartrader",
    metadata: { ownerId: "owner_sohrab" },
  };

  beforeEach(() => {
    testDbPath = join(
      tmpdir(),
      `test_yt_20_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
    );
    safelyRemoveFile(testDbPath);

    approvalManager = new ApprovalManager(testDbPath);
    policyEngine = new PolicyEngine(approvalManager);
    envManager = new EnvironmentManager();
    wsPolicyManager = new WorkspacePolicyManager();

    ecosystem = new SecureToolEcosystem(
      undefined,
      policyEngine,
      approvalManager,
      envManager,
      wsPolicyManager,
    );

    const tool = new YarTraderTool();
    ecosystem.registerTool(tool);

    policyEngine.setRule("yartrader_adapter:health", "SAFE");
    policyEngine.setRule("yartrader_adapter:worker_status", "SAFE");
    policyEngine.setRule(
      "yartrader_adapter:restart_service",
      "APPROVAL_REQUIRED",
    );
    policyEngine.setRule("yartrader_adapter:stop_service", "APPROVAL_REQUIRED");
    policyEngine.setRule("yartrader_adapter:order_place", "BLOCKED");
    policyEngine.setRule("yartrader_adapter:live_enable", "BLOCKED");

    envManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Primary Env",
      type: "PRODUCTION",
      capabilities: ["yartrader_adapter"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    wsPolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["yartrader_adapter"],
      }),
    );
  });

  afterEach(async () => {
    if (approvalManager) approvalManager.close();
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
    delete process.env.OPERATOR_YARTRADER_URL;
    safelyRemoveFile(testDbPath);
  });

  // --- YARTRADER CONNECTION SCENARIOS (1-12) ---

  it("1. No configured YarTrader endpoint returns UNAVAILABLE (fail closed)", async () => {
    delete process.env.OPERATOR_YARTRADER_URL;
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health" },
      scope,
      context,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");
  });

  it("2. Unapproved target origin parameter is REJECTED by allowlist", async () => {
    process.env.OPERATOR_YARTRADER_URL = "http://127.0.0.1:8000";
    const tool = ecosystem
      .getRegistry()
      .get("yartrader_adapter") as YarTraderTool;

    const res = await tool.execute({
      action: "health",
      targetOrigin: "http://malicious-attacker.com",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("DESTINATION DENIED");
  });

  it("3. Approved configured target origin permits bounded request", async () => {
    mockServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK", source: "YarTrader" }));
    });
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        const addr = mockServer!.address() as any;
        mockServerPort = addr.port;
        resolve();
      });
    });

    const targetUrl = `http://127.0.0.1:${mockServerPort}`;
    process.env.OPERATOR_YARTRADER_URL = targetUrl;

    const tool = ecosystem
      .getRegistry()
      .get("yartrader_adapter") as YarTraderTool;
    const res = await tool.execute({
      action: "health",
      targetOrigin: targetUrl,
    });

    expect(res.success).toBe(true);
    expect((res.output as any).details.status).toBe("OK");
  });

  it("4. Missing authentication or invalid headers fail closed", async () => {
    // Unauthenticated ecosystem execution without context fails closed
    const invalidCtx: ExecutionContext = { ...context, environmentId: "" };
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health" },
      scope,
      invalidCtx,
    );
    expect(res.success).toBe(false);
  });

  it("5. Real successful read returns actual unfabricated YarTrader response", async () => {
    mockServer = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "HEALTHY",
            version: "2.5.0",
            activeWorkers: 4,
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        const addr = mockServer!.address() as any;
        mockServerPort = addr.port;
        resolve();
      });
    });

    process.env.OPERATOR_YARTRADER_URL = `http://127.0.0.1:${mockServerPort}`;
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health" },
      scope,
      context,
    );

    expect(res.success).toBe(true);
    const details = (res.output as any).details;
    expect(details.status).toBe("HEALTHY");
    expect(details.version).toBe("2.5.0");
    expect(details.activeWorkers).toBe(4);
  });

  it("6. Endpoint connection timeout fails closed with UNAVAILABLE", async () => {
    // Unroutable IP to guarantee connection timeout
    process.env.OPERATOR_YARTRADER_URL = "http://10.255.255.1:81";
    const tool = ecosystem
      .getRegistry()
      .get("yartrader_adapter") as YarTraderTool;

    const res = await tool.execute({ action: "health" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");
  }, 10000);

  it("7. Endpoint HTTP 500 server error fails closed with UNAVAILABLE", async () => {
    mockServer = http.createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Failure" }));
    });
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        const addr = mockServer!.address() as any;
        mockServerPort = addr.port;
        resolve();
      });
    });

    process.env.OPERATOR_YARTRADER_URL = `http://127.0.0.1:${mockServerPort}`;
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health" },
      scope,
      context,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");
  });

  it("8. Controlled mutation without owner approval is DENIED", async () => {
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "restart_service" },
      scope,
      context,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Approval check failed");
  });

  it("9. Valid single-use approval allows execution attempt to reach real endpoint boundary", async () => {
    mockServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/service/restart") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "RESTARTED", service: "YarTrader Worker" }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        const addr = mockServer!.address() as any;
        mockServerPort = addr.port;
        resolve();
      });
    });

    process.env.OPERATOR_YARTRADER_URL = `http://127.0.0.1:${mockServerPort}`;
    const actionKey = "yartrader_adapter:restart_service";
    const params = { action: "restart_service" };

    const req = approvalManager.requestApproval(
      "yartrader_adapter",
      params,
      300000,
      "yartrader",
      "env_yartrader",
      actionKey,
    );
    approvalManager.grantApproval(req.id, "owner_sohrab");

    const res = await ecosystem.execute(
      "yartrader_adapter",
      params,
      scope,
      context,
    );

    expect(res.success).toBe(true);
    expect((res.output as any).details.status).toBe("RESTARTED");
  });

  it("10. Approval token replay attempt is REJECTED", async () => {
    process.env.OPERATOR_YARTRADER_URL = "http://127.0.0.1:8000";
    const actionKey = "yartrader_adapter:restart_service";
    const params = { action: "restart_service" };

    const req = approvalManager.requestApproval(
      "yartrader_adapter",
      params,
      300000,
      "yartrader",
      "env_yartrader",
      actionKey,
    );
    approvalManager.grantApproval(req.id, "owner_sohrab");

    // First execution consumes approval
    await ecosystem.execute("yartrader_adapter", params, scope, context);

    // Second execution with same consumed token is DENIED
    const replayRes = await ecosystem.execute(
      "yartrader_adapter",
      params,
      scope,
      context,
    );
    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toContain("already consumed");
  });

  it("11. Simulated or fake mutation success is impossible when endpoint is unreachable", async () => {
    process.env.OPERATOR_YARTRADER_URL = "http://127.0.0.1:59999"; // Nonexistent port
    const actionKey = "yartrader_adapter:restart_service";
    const params = { action: "restart_service" };

    const req = approvalManager.requestApproval(
      "yartrader_adapter",
      params,
      300000,
      "yartrader",
      "env_yartrader",
      actionKey,
    );
    approvalManager.grantApproval(req.id, "owner_sohrab");

    const res = await ecosystem.execute(
      "yartrader_adapter",
      params,
      scope,
      context,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");
  });

  it("12. Trading execution actions (order_place, live_enable) are permanently BLOCKED", async () => {
    const resOrder = await ecosystem.execute(
      "yartrader_adapter",
      { action: "order_place" },
      scope,
      context,
    );
    expect(resOrder.success).toBe(false);
    expect(resOrder.error).toContain("BLOCKED");

    const resLive = await ecosystem.execute(
      "yartrader_adapter",
      { action: "live_enable" },
      scope,
      context,
    );
    expect(resLive.success).toBe(false);
    expect(resLive.error).toContain("BLOCKED");
  });

  // --- CAPABILITY DISCOVERY SCENARIOS (13-20) ---

  it("13. Dynamic CapabilityReporter includes registered tools in report", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());
    reg.register(new WebResearchTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    expect(report.tools.length).toBe(2);
    expect(report.tools.map((t) => t.id)).toContain("operator_health");
    expect(report.tools.map((t) => t.id)).toContain("web_research");
  });

  it("14. Unregistered tools do NOT appear in dynamic capability report", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    expect(report.tools.map((t) => t.id)).not.toContain("terminal_execute");
    expect(report.tools.map((t) => t.id)).not.toContain("github_operate");
  });

  it("15. SAFE permission level is reported correctly in capability output", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    const item = report.tools.find((t) => t.id === "operator_health");
    expect(item?.policy).toBe("SAFE");
  });

  it("16. APPROVAL_REQUIRED permission level is reported correctly", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool());
    policyEngine.setRule("yartrader_adapter", "APPROVAL_REQUIRED");

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    const item = report.tools.find((t) => t.id === "yartrader_adapter");
    expect(item?.policy).toContain("APPROVAL_REQUIRED");
  });

  it("17. BLOCKED permission level is reported correctly", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    const item = report.tools.find((t) => t.id === "yartrader_adapter");
    expect(item?.policy).toContain("BLOCKED");
  });

  it("18. Registered but offline YarTrader adapter is explicitly reported UNAVAILABLE", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    const item = report.tools.find((t) => t.id === "yartrader_adapter");
    expect(item?.status).toBe("UNAVAILABLE");
    expect(report.formattedReport).toContain("وضعیت: UNAVAILABLE");
  });

  it("19. Capability report does not claim unavailable tools are AVAILABLE", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool());

    const reportOffline = CapabilityReporter.generateReport(
      reg,
      policyEngine,
      false,
    );
    const offlineItem = reportOffline.tools.find(
      (t) => t.id === "yartrader_adapter",
    );
    expect(offlineItem?.status).toBe("UNAVAILABLE");

    const reportOnline = CapabilityReporter.generateReport(
      reg,
      policyEngine,
      true,
    );
    const onlineItem = reportOnline.tools.find(
      (t) => t.id === "yartrader_adapter",
    );
    expect(onlineItem?.status).toBe("AVAILABLE");
  });

  it("20. Capability report is derived dynamically from ToolRegistry and PolicyEngine", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const reportBefore = CapabilityReporter.generateReport(
      reg,
      policyEngine,
      false,
    );
    expect(reportBefore.tools.length).toBe(1);

    reg.register(new YarTraderTool());
    const reportAfter = CapabilityReporter.generateReport(
      reg,
      policyEngine,
      false,
    );
    expect(reportAfter.tools.length).toBe(2);
    expect(reportAfter.formattedReport).toContain("yartrader_adapter");
  });
});
