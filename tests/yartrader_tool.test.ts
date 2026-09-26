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

describe("YarTrader Tool, Authentication & Dynamic 5-State Capability Discovery Suite", () => {
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

    const tool = new YarTraderTool({ testSecret: TEST_SECRET });
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

  // --- YARTRADER AUTHENTICATION & CONNECTION SCENARIOS ---

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
      testSecret: "invalid_wrong_secret",
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
      testSecret: TEST_SECRET,
    });

    const res = await tool.execute({ action: "health" });
    expect(res.success).toBe(true);
    expect(capturedHeader).toBe(`Bearer ${TEST_SECRET}`);
  });

  it("4. Tool parameters cannot override or inject credentials or headers", async () => {
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
      testSecret: TEST_SECRET,
    });

    const paramsWithHackedSecret: any = {
      action: "health",
      secret: "hacked_user_secret",
      apiKey: "hacked_api_key",
      headers: { Authorization: "Bearer hacked" },
    };

    const res = await tool.execute(paramsWithHackedSecret);
    expect(res.success).toBe(true);
    expect(capturedHeader).toBe(`Bearer ${TEST_SECRET}`);
  });

  it("5. Unapproved target origin parameter is REJECTED by allowlist", async () => {
    process.env.OPERATOR_YARTRADER_URL = "http://127.0.0.1:8000";
    const tool = new YarTraderTool({ testSecret: TEST_SECRET });

    const res = await tool.execute({
      action: "health",
      targetOrigin: "http://malicious-attacker.com",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("DESTINATION DENIED");
  });

  // --- DYNAMIC 5-STATE CAPABILITY REPORTER TESTS (12 SCENARIOS) ---

  it("6 (Req 1). SAFE + available = AVAILABLE", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("operator_health:check", "SAFE");

    const report = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report.tools[0].id).toBe("operator_health");
    expect(report.tools[0].state).toBe("AVAILABLE");
  });

  it("7 (Req 2). SAFE + unavailable = UNAVAILABLE", () => {
    const reg = new ToolRegistry();
    const toolOffline = new YarTraderTool(); // Missing secret -> isAvailable() = false
    reg.register(toolOffline);

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("yartrader_adapter:health", "SAFE");

    const report = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report.tools[0].id).toBe("yartrader_adapter");
    expect(report.tools[0].state).toBe("UNAVAILABLE");
  });

  it("8 (Req 3). APPROVAL_REQUIRED + available = APPROVAL_REQUIRED", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool({ testSecret: "sec" }));

    const testPolicy = new PolicyEngine();
    testPolicy.setRule(
      "yartrader_adapter:restart_service",
      "APPROVAL_REQUIRED",
    );

    const report = CapabilityReporter.generateReport(reg, testPolicy, {
      yartrader_adapter: true,
    });
    expect(report.tools[0].state).toBe("APPROVAL_REQUIRED");
  });

  it("9 (Req 4). APPROVAL_REQUIRED + unavailable = UNAVAILABLE", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool()); // Offline -> isAvailable() = false

    const testPolicy = new PolicyEngine();
    testPolicy.setRule(
      "yartrader_adapter:restart_service",
      "APPROVAL_REQUIRED",
    );

    const report = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report.tools[0].state).toBe("UNAVAILABLE");
  });

  it("10 (Req 5 & 6). BLOCKED + available/unavailable = BLOCKED (precedence over availability)", () => {
    const reg = new ToolRegistry();
    reg.register(new YarTraderTool({ testSecret: "sec" }));

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("yartrader_adapter:order_place", "BLOCKED");

    // Case 1: Runtime available -> BLOCKED
    const reportOnline = CapabilityReporter.generateReport(reg, testPolicy, {
      yartrader_adapter: true,
    });
    const onlineAction = reportOnline.tools[0].actions?.find(
      (a) => a.action === "order_place",
    );
    expect(onlineAction?.state).toBe("BLOCKED");

    // Case 2: Runtime unavailable -> BLOCKED (Policy dominates)
    const reportOffline = CapabilityReporter.generateReport(reg, testPolicy, {
      yartrader_adapter: false,
    });
    const offlineAction = reportOffline.tools[0].actions?.find(
      (a) => a.action === "order_place",
    );
    expect(offlineAction?.state).toBe("BLOCKED");
  });

  it("11 (Req 7). No explicit PolicyEngine rule = REGISTERED", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const testPolicy = new PolicyEngine(); // No rules set

    const report = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report.tools[0].id).toBe("operator_health");
    expect(report.tools[0].state).toBe("REGISTERED");
    expect(report.tools[0].policy).toBe("NO_EXPLICIT_POLICY_RULE");
  });

  it("12 (Req 8). Dynamic PolicyEngine rule changes alter structured capability state", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("operator_health:check", "SAFE");

    const report1 = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report1.tools[0].state).toBe("AVAILABLE");

    // Update rule to APPROVAL_REQUIRED
    testPolicy.setRule("operator_health:check", "APPROVAL_REQUIRED");
    const report2 = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report2.tools[0].state).toBe("APPROVAL_REQUIRED");

    // Update rule to BLOCKED
    testPolicy.setRule("operator_health:check", "BLOCKED");
    const report3 = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report3.tools[0].state).toBe("BLOCKED");
  });

  it("13 (Req 9). Newly registered tools automatically appear without reporter code changes", () => {
    const reg = new ToolRegistry();
    reg.register(new OperatorHealthTool());

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("operator_health:check", "SAFE");

    const report1 = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report1.tools.length).toBe(1);

    // Dynamically register new tool
    reg.register(new WebResearchTool());
    testPolicy.setRule("web_research:search", "SAFE");

    const report2 = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report2.tools.length).toBe(2);
    expect(report2.tools.map((t) => t.id)).toContain("web_research");
  });

  it("14 (Req 10). Metadata safety level cannot override explicit PolicyEngine rule", () => {
    const reg = new ToolRegistry();
    const healthTool = new OperatorHealthTool(); // Metadata safetyLevel = SAFE
    reg.register(healthTool);

    const testPolicy = new PolicyEngine();
    testPolicy.setRule("operator_health:check", "BLOCKED"); // Explicit PolicyEngine rule

    const report = CapabilityReporter.generateReport(reg, testPolicy);
    expect(report.tools[0].state).toBe("BLOCKED");
  });

  it("15 (Req 11 & 12). YarTrader missing secret = UNAVAILABLE, and trading actions = BLOCKED", async () => {
    delete process.env.OPERATOR_YARTRADER_SECRET;
    const toolOffline = new YarTraderTool();

    expect(toolOffline.isAvailable()).toBe(false);

    const resOrder = await ecosystem.execute(
      "yartrader_adapter",
      { action: "order_place" },
      scope,
      context,
    );
    expect(resOrder.success).toBe(false);
    expect(resOrder.error).toContain("BLOCKED");
  });
});
