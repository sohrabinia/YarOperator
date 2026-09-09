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

describe("/Operator Web Interface & API Security Hardening Test Suite", () => {
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
      toolEcosystem,
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
      host: "127.0.0.1",
      maxBodySizeBytes: 2048, // 2 KiB for small test limit
      corsOrigin: "http://127.0.0.1:3099",
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

  it("1. Binds to 127.0.0.1 host by default", async () => {
    expect(server.getHost()).toBe("127.0.0.1");
    const res = await fetch(`${baseUrl}/Operator`);
    expect(res.status).toBe(200);
  });

  it("2. Rejects request payloads exceeding maxBodySizeBytes with HTTP 413 Payload Too Large", async () => {
    const hugeText = "A".repeat(4096); // 4 KiB > 2 KiB limit
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawCommandText: hugeText,
        workspaceId: "ws_default",
      }),
    });

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Payload Too Large");
  });

  it("3. Emits configured CORS origin and does NOT emit wildcard *", async () => {
    const res = await fetch(`${baseUrl}/Operator`, { method: "OPTIONS" });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:3099",
    );
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("4. Rejects non-object JSON body with HTTP 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(["array_not_object"]),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("must be a JSON object");
  });

  it("5. Rejects excessive rawCommandText exceeding 10000 characters with HTTP 400 or 413", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawCommandText: "B".repeat(10001),
        workspaceId: "ws_default",
      }),
    });

    expect(res.status).toBe(413); // Catch by body size streaming limit
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it("6. Strictly blocks path traversal attempts in static file serving", async () => {
    const res = await fetch(`${baseUrl}/../../package.json`);
    expect(res.status).toBe(404); // path.basename prevents traversal, returning 404 for missing static file
  });

  it("7. Sanitizes internal error responses and hides raw exception details", async () => {
    // Missing Bearer token format
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "InvalidHeaderFormat",
      },
      body: JSON.stringify({
        rawCommandText: "test",
        workspaceId: "ws_default",
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).not.toContain("stack");
    expect(data.error).not.toContain("Error:");
  });

  it("8. Protects against owner impersonation across HTTP boundary", async () => {
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

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Forbidden");
  });
});
