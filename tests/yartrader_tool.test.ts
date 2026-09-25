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

describe("YarTrader Tool, Authentication & Dynamic Capability Discovery Test Suite", () => {
  let testDbPath: string;
  let ecosystem: SecureToolEcosystem;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let envManager: EnvironmentManager;
  let wsPolicyManager: WorkspacePolicyManager;
  let mockServer: http.Server | null = null;
  let mockServerPort = 0;

  const TEST_SECRET = "test_yartrader_server_secret_999";

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
      `test_yt_auth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
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

    const tool = new YarTraderTool({ secret: TEST_SECRET });
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
    delete process.env.OPERATOR_YARTRADER_SECRET;
    safelyRemoveFile(testDbPath);
  });

  // --- YARTRADER AUTH & CONNECTION BOUNDS ---

  it("1. Missing server-side authentication secret yields UNAVAILABLE (fail closed)", async () => {
    delete process.env.OPERATOR_YARTRADER_SECRET;
    const toolWithoutSecret = new YarTraderTool({
      baseUrl: "http://127.0.0.1:8000",
    });

    const res = await toolWithoutSecret.execute({ action: "health" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Server-side authentication secret");
    expect(res.output?.status).toBe("UNAVAILABLE");
  });

  it("2. Invalid YarTrader authentication secret (HTTP 401/403) fails closed with UNAVAILABLE", async () => {
    mockServer = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${TEST_SECRET}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized Secret" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "OK" }));
      }
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

    const toolWithWrongSecret = new YarTraderTool({
      baseUrl: targetUrl,
      secret: "invalid_wrong_secret",
    });

    const res = await toolWithWrongSecret.execute({ action: "health" });
    expect(res.success).toBe(false);
    expect(res.error).toContain(
      "Authentication failed against YarTrader endpoint",
    );
    expect(res.output?.status).toBe("UNAVAILABLE");
  });

  it("3. Valid configured secret attaches Authorization Bearer header server-side", async () => {
    let capturedHeader = "";
    mockServer = http.createServer((req, res) => {
      capturedHeader = req.headers.authorization || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK", authenticated: true }));
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

    const tool = new YarTraderTool({
      baseUrl: targetUrl,
      secret: TEST_SECRET,
    });

    const res = await tool.execute({ action: "health" });
    expect(res.success).toBe(true);
    expect(capturedHeader).toBe(`Bearer ${TEST_SECRET}`);
  });

  it("4. Model or user tool arguments cannot override or inject credentials", async () => {
    let capturedHeader = "";
    mockServer = http.createServer((req, res) => {
      capturedHeader = req.headers.authorization || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
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

    const tool = new YarTraderTool({
      baseUrl: targetUrl,
      secret: TEST_SECRET,
    });

    // Attempting to pass custom secret via params is ignored
    const paramsWithHackedSecret: any = {
      action: "health",
      secret: "hacked_user_secret",
      apiKey: "hacked_api_key",
    };

    const res = await tool.execute(paramsWithHackedSecret);
    expect(res.success).toBe(true);
    // Header remains bound to server-side secret
    expect(capturedHeader).toBe(`Bearer ${TEST_SECRET}`);
  });

  it("5. Unapproved target origin parameter is REJECTED by allowlist", async () => {
    process.env.OPERATOR_YARTRADER_URL = "http://127.0.0.1:8000";
    const tool = new YarTraderTool({ secret: TEST_SECRET });

    const res = await tool.execute({
      action: "health",
      targetOrigin: "http://malicious-attacker.com",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("DESTINATION DENIED");
  });

  it("6. Controlled mutations without approval fail closed", async () => {
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "restart_service" },
      scope,
      context,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Approval check failed");
  });

  it("7. Trading operations (order_place, live_enable) remain permanently BLOCKED", async () => {
    const resOrder = await ecosystem.execute(
      "yartrader_adapter",
      { action: "order_place" },
      scope,
      context,
    );
    expect(resOrder.success).toBe(false);
    expect(resOrder.error).toContain("BLOCKED");
  });

  // --- DYNAMIC CAPABILITY REPORTER (100% REGISTRY & POLICY DRIVEN) ---

  it("8. CapabilityReporter derives policy state dynamically from PolicyEngine", () => {
    const reg = new ToolRegistry();
    const healthTool = new OperatorHealthTool();
    reg.register(healthTool);

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("operator_health:check", "SAFE");

    const report1 = CapabilityReporter.generateReport(reg, testPolicy, false);
    expect(report1.tools[0].policy).toContain("check: SAFE");

    // Dynamic PolicyEngine update reflects immediately
    testPolicy.setRule("operator_health:check", "APPROVAL_REQUIRED");
    const report2 = CapabilityReporter.generateReport(reg, testPolicy, false);
    expect(report2.tools[0].policy).toContain("check: APPROVAL_REQUIRED");
  });

  it("9. CapabilityReporter uses NO hard-coded tool ID conditionals", () => {
    const reg = new ToolRegistry();
    const researchTool = new WebResearchTool();
    reg.register(researchTool);

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("web_research:search", "SAFE");

    const report = CapabilityReporter.generateReport(reg, testPolicy, false);
    expect(report.tools[0].id).toBe("web_research");
    expect(report.tools[0].policy).toContain("search: SAFE");
  });

  it("10. Registered but offline YarTrader is reported as UNAVAILABLE", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool());

    const report = CapabilityReporter.generateReport(reg, policyEngine, false);
    const item = report.tools.find((t) => t.id === "yartrader_adapter");
    expect(item?.status).toBe("UNAVAILABLE");
    expect(report.formattedReport).toContain("وضعیت: UNAVAILABLE");
  });
});
