import { describe, it, expect, beforeEach } from "vitest";
import { OperatorApiHandler, OperatorApiRequest } from "../src/api/operator.js";
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

class MockChatTool implements Tool {
  metadata = {
    id: "mock_chat_tool",
    name: "Mock Chat Interface Tool",
    description: "Builds chat UI interface",
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
      output: { built: true, params },
    };
  }
}

describe("Operator API Boundary & Natural-Language Goal Resolution", () => {
  let ownerManager: OwnerManager;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let toolEcosystem: SecureToolEcosystem;
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let autonomyEngine: ControlledAutonomyEngine;
  let assistant: RealWorldAssistant;
  let commandReceiver: OwnerCommandReceiver;
  let apiHandler: OperatorApiHandler;
  let mockTool: MockChatTool;
  let mockContext: ExecutionContext;

  const realPersianPrompt = "برای خودت یک رابط چت ساده و امن بساز";
  const bearerToken = "secret_owner_bearer_token_123";

  beforeEach(() => {
    ownerManager = new OwnerManager();
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    toolEcosystem = new SecureToolEcosystem();
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);

    mockTool = new MockChatTool();
    toolEcosystem.registerTool(mockTool);

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      undefined,
      auditManager,
      notificationManager,
    );

    assistant = new RealWorldAssistant(
      orchestrator,
      policyEngine,
      autonomyEngine,
      auditManager,
      notificationManager,
    );

    ownerManager.createProfile({
      id: "owner_sohrab",
      name: "Sohrab",
      defaultWorkspaceId: "yartrader",
    });

    commandReceiver = new OwnerCommandReceiver(
      ownerManager,
      policyEngine,
      auditManager,
      assistant,
      orchestrator,
    );

    apiHandler = new OperatorApiHandler(commandReceiver, {
      [bearerToken]: "owner_sohrab",
    });

    agentRegistry.registerAgent({
      id: "jules_autonomy_agent",
      name: "Assistant Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["mock_chat_tool"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    mockContext = {
      executionId: "exec_api_1",
      timestamp: new Date(),
    };
  });

  it("1. Unauthenticated API request without Bearer token returns 401 Unauthorized", async () => {
    const req: OperatorApiRequest = {
      headers: {}, // No Bearer token
      body: {
        workspaceId: "yartrader",
        rawCommandText: realPersianPrompt,
      },
    };

    const res = await apiHandler.handleChatRequest(req, mockContext);
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Missing or invalid Bearer token");
  });

  it("2. Owner impersonation attempt returns 403 Forbidden", async () => {
    const req: OperatorApiRequest = {
      headers: { authorization: `Bearer ${bearerToken}` },
      body: {
        ownerId: "impersonated_owner", // Does not match authenticated owner_sohrab
        workspaceId: "yartrader",
        rawCommandText: realPersianPrompt,
      },
    };

    const res = await apiHandler.handleChatRequest(req, mockContext);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("cannot submit commands as owner");
  });

  it("3. Persian prompt WITHOUT requestedToolId resolves capability and tool safely via Orchestrator", async () => {
    policyEngine.setRule("mock_chat_tool", "SAFE");

    const req: OperatorApiRequest = {
      headers: { authorization: `Bearer ${bearerToken}` },
      body: {
        workspaceId: "yartrader",
        rawCommandText: realPersianPrompt, // NO requestedToolId provided!
      },
    };

    const res = await apiHandler.handleChatRequest(req, mockContext);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result?.status).toBe("COMPLETED");
    expect(res.body.result?.preservedCommandText).toBe(realPersianPrompt);
    expect(res.body.result?.resolvedCapability).toBe("software-development");
    expect(res.body.result?.resolvedToolId).toBe("mock_chat_tool");
    expect(mockTool.invocations.length).toBe(1);

    const auditEvents = await auditManager.queryEvents({
      workspaceId: "yartrader",
    });
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(auditEvents[0].payload.rawCommandText).toBe(realPersianPrompt);
  });

  it("4. Resolved capability requiring APPROVAL_REQUIRED halts cleanly with APPROVAL_REQUIRED status", async () => {
    policyEngine.setRule("mock_chat_tool", "APPROVAL_REQUIRED");

    const req: OperatorApiRequest = {
      headers: { authorization: `Bearer ${bearerToken}` },
      body: {
        workspaceId: "yartrader",
        rawCommandText: realPersianPrompt,
      },
    };

    const res = await apiHandler.handleChatRequest(req, mockContext);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result?.status).toBe("APPROVAL_REQUIRED");
    expect(mockTool.invocations.length).toBe(0); // Tool NEVER invoked

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("APPROVAL_REQUIRED");
  });

  it("5. Resolved capability with BLOCKED rule fails closed immediately with BLOCKED status", async () => {
    policyEngine.setRule("mock_chat_tool", "BLOCKED");

    const req: OperatorApiRequest = {
      headers: { authorization: `Bearer ${bearerToken}` },
      body: {
        workspaceId: "yartrader",
        rawCommandText: realPersianPrompt,
      },
    };

    const res = await apiHandler.handleChatRequest(req, mockContext);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result?.status).toBe("BLOCKED");
    expect(mockTool.invocations.length).toBe(0); // Tool NEVER invoked
  });
});
