import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, existsSync } from "node:fs";
import { SecureToolEcosystem, YarTraderTool } from "../src/core/tools/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { ExecutionScope } from "../src/core/orchestrator/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

function safelyRemoveFile(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}

describe("YarTrader Tool & M12/M6 Full Execution Pipeline Test Suite", () => {
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
      `test_yt_pipe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
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

    // Policy Rules
    policyEngine.setRule("yartrader_adapter:health", "SAFE");
    policyEngine.setRule("yartrader_adapter:worker_status", "SAFE");
    policyEngine.setRule(
      "yartrader_adapter:restart_service",
      "APPROVAL_REQUIRED",
    );
    policyEngine.setRule("yartrader_adapter:stop_service", "APPROVAL_REQUIRED");
    policyEngine.setRule("yartrader_adapter:order_place", "BLOCKED");
    policyEngine.setRule("yartrader_adapter:live_enable", "BLOCKED");

    // Environment & Workspace Registration
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
    safelyRemoveFile(testDbPath);
  });

  it("1. Direct unauthorized mutation through SecureToolEcosystem is DENIED (missing approval)", async () => {
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "restart_service" },
      scope,
      context,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Approval check failed");
  });

  it("2. Single-use Approval flow through SecureToolEcosystem: Request -> Grant -> Execute -> Replay Blocked", async () => {
    const actionKey = "yartrader_adapter:restart_service";
    const params = { action: "restart_service" };

    // Request Approval
    const req = approvalManager.requestApproval(
      "yartrader_adapter",
      params,
      300000,
      "yartrader",
      "env_yartrader",
      actionKey,
    );

    // Grant Approval
    const granted = approvalManager.grantApproval(req.id, "owner_sohrab");
    expect(granted).toBe(true);

    // Execute via Ecosystem (Unconfigured endpoint fails closed with UNAVAILABLE without fake completion)
    const res = await ecosystem.execute(
      "yartrader_adapter",
      params,
      scope,
      context,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");

    // Replay Attempt using consumed approval fingerprint is DENIED
    const replayRes = await ecosystem.execute(
      "yartrader_adapter",
      params,
      scope,
      context,
    );

    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toContain("already consumed");
  });

  it("3. Forbidden trading operations (order_place, live_enable) are explicitly BLOCKED at PolicyEngine", async () => {
    const resOrder = await ecosystem.execute(
      "yartrader_adapter",
      { action: "order_place" },
      scope,
      context,
    );

    expect(resOrder.success).toBe(false);
    expect(resOrder.error).toContain("explicitly BLOCKED by policy");

    const resLive = await ecosystem.execute(
      "yartrader_adapter",
      { action: "live_enable" },
      scope,
      context,
    );

    expect(resLive.success).toBe(false);
    expect(resLive.error).toContain("explicitly BLOCKED by policy");
  });

  it("4. Unconfigured YarTrader endpoint returns status UNAVAILABLE (no fabricated state)", async () => {
    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health" },
      scope,
      context,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("YarTrader connection UNAVAILABLE");
  });

  it("5. Real bounded HTTP communication returns actual verified YarTrader response", async () => {
    // Start local mock YarTrader HTTP server
    mockServer = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "HEALTHY",
            version: "2.1.0",
            uptime: 12345,
            liveMode: false,
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

    const targetUrl = `http://127.0.0.1:${mockServerPort}`;

    const res = await ecosystem.execute(
      "yartrader_adapter",
      { action: "health", targetOrigin: targetUrl },
      scope,
      context,
    );

    expect(res.success).toBe(true);
    const output = res.output as any;
    expect(output.status).toBe("OK");
    expect(output.details.status).toBe("HEALTHY");
    expect(output.details.version).toBe("2.1.0");
    expect(output.details.liveMode).toBe(false);
  });

  it("6. Capability discovery in DeterministicBrain reflects real registered tools accurately", () => {
    const brain = new DeterministicBrain();
    const result = brain.interpret({
      rawCommandText: "چه ابزارها و دسترسی‌هایی داری؟",
    });

    expect(result.intent).toBe("CONVERSATION");
    expect(result.reply).toContain("yartrader_adapter");
    expect(result.reply).toContain("operator_health");
  });
});
