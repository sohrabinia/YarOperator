import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperatorWebServer } from "../src/web/server.js";
import { OperatorApiHandler } from "../src/api/operator.js";
import { OwnerManager, OwnerCommandReceiver } from "../src/core/owner/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { ControlledAutonomyEngine } from "../src/core/autonomy/index.js";
import { RealWorldAssistant } from "../src/core/assistant/index.js";
import {
  SecureToolEcosystem,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

class TerminalMockTool implements Tool {
  metadata = {
    id: "terminal_execute",
    name: "Terminal Execution Tool",
    description: "Executes controlled terminal shell commands status",
    safetyLevel: "SAFE" as const,
  };
  invocations: any[] = [];

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push({ params, context });
    return {
      success: true,
      output: {
        stdout: "On branch main\nnothing to commit, working tree clean",
        stderr: "",
        exitCode: 0,
      },
    };
  }
}

describe("/Operator Web Interface & API Integration Test Suite", () => {
  let server: OperatorWebServer;
  let baseUrl: string;
  let policyEngine: PolicyEngine;
  let toolEcosystem: SecureToolEcosystem;
  let mockTool: TerminalMockTool;
  const token = "owner-secret-token-123";

  beforeEach(async () => {
    const ownerManager = new OwnerManager();
    const approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager();
    toolEcosystem = new SecureToolEcosystem();
    const agentRegistry = new AgentRegistry();
    const orchestrator = new AgentOrchestrator(agentRegistry);

    mockTool = new TerminalMockTool();
    toolEcosystem.registerTool(mockTool);

    const autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      undefined,
      auditManager,
      notificationManager,
    );

    const assistant = new RealWorldAssistant(
      orchestrator,
      policyEngine,
      autonomyEngine,
      auditManager,
      notificationManager,
    );

    ownerManager.createProfile({
      id: "owner_sohrab",
      name: "Sohrab",
      defaultWorkspaceId: "ws_default",
    });

    const receiver = new OwnerCommandReceiver(
      ownerManager,
      policyEngine,
      auditManager,
      assistant,
      orchestrator,
    );

    agentRegistry.registerAgent({
      id: "jules_autonomy_agent",
      name: "Assistant Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["ws_default"],
      toolScopes: ["terminal_execute"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const apiHandler = new OperatorApiHandler(receiver, {
      [token]: "owner_sohrab",
    });

    server = new OperatorWebServer({
      port: 0,
      apiHandler,
    });

    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("1. Renders /Operator page with RTL and Persian structure", async () => {
    const res = await fetch(`${baseUrl}/Operator`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
    expect(html).toContain("YarOperator");
    expect(html).toContain("Executive Assistant");
    expect(html).toContain("Enter = ارسال | Shift + Enter = خط جدید");
  });

  it("2. Protects /api/v1/operator/chat with Bearer authentication", async () => {
    // Missing token
    const res1 = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawCommandText: "hello",
        workspaceId: "ws_default",
      }),
    });
    expect(res1.status).toBe(401);

    // Invalid token
    const res2 = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({
        rawCommandText: "hello",
        workspaceId: "ws_default",
      }),
    });
    expect(res2.status).toBe(401);
  });

  it("3. Accepts Persian commands via API and preserves Persian rawCommandText", async () => {
    policyEngine.setRule("terminal_execute", "SAFE");

    const persianText = "سلام وضعیت";
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawCommandText: persianText,
        workspaceId: "ws_default",
        environmentId: "development",
        requestedToolId: "terminal_execute",
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.accepted).toBe(true);
    expect(data.result.preservedCommandText).toBe(persianText);
  });

  it("4. Returns COMPLETED status for authorized terminal command execution", async () => {
    policyEngine.setRule("terminal_execute", "SAFE");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawCommandText: "git status",
        workspaceId: "ws_default",
        environmentId: "development",
        requestedToolId: "terminal_execute",
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.status).toBe("COMPLETED");
  });

  it("5. Fails closed when workspace is missing (400 Bad Request)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawCommandText: "یک چای داغ دم کن",
        environmentId: "development",
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("workspaceId is required");
  });

  it("6. Prevents owner impersonation attempts across API boundary", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ownerId: "impersonated_other_owner",
        rawCommandText: "git status",
        workspaceId: "ws_default",
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Forbidden");
  });
});
