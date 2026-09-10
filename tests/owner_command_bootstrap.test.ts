import { describe, it, expect, beforeEach } from "vitest";
import {
  OwnerManager,
  OwnerCommandReceiver,
  OwnerCommandInput,
} from "../src/core/owner/index.js";
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
import { EnvironmentManager } from "../src/core/environment/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

class MockCommandTool implements Tool {
  metadata = {
    id: "mock_command_tool",
    name: "Mock Command Tool",
    description: "Tool for testing command handoff and chat interface",
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
      output: { executed: true, params },
    };
  }
}

describe("Owner Command Input Boundary & Bootstrap Path", () => {
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
  let receiver: OwnerCommandReceiver;
  let mockTool: MockCommandTool;
  let mockContext: ExecutionContext;

  const realPersianCommand =
    "برای خودت یک رابط چت ساده و امن طراحی و پیاده‌سازی کن تا مالک بتواند مستقیماً با تو صحبت کند. رابط باید شبیه یک صفحه چت ساده باشد، نه یک داشبورد پیچیده. ابتدا معماری و نیازمندی‌ها را بررسی کن، سپس یک برنامه اجرای حداقلی ارائه بده و فقط اقدامات SAFE را خودت انجام بده. هر اقدام نیازمند تأیید را متوقف کن و از مالک اجازه بگیر.";

  beforeEach(() => {
    ownerManager = new OwnerManager();
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    toolEcosystem = new SecureToolEcosystem();
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);

    mockTool = new MockCommandTool();
    toolEcosystem.registerTool(mockTool);

    const environmentManager = new EnvironmentManager();
    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Env",
      type: "PRODUCTION",
      capabilities: ["mock_command_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      undefined,
      auditManager,
      notificationManager,
      undefined,
      environmentManager,
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

    receiver = new OwnerCommandReceiver(
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
      workspaceScopes: ["yartrader"],
      toolScopes: ["mock_command_tool"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    mockContext = {
      executionId: "exec_bootstrap_1",
      timestamp: new Date(),
    };
  });

  it("1. Owner command reaches YarOperator intake path and preserves Persian/Unicode text", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_persian_1",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: realPersianCommand,
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(true);
    expect(result.commandTextPreserved).toBe(realPersianCommand);
    expect(result.auditEventId).toBeDefined();

    const auditEvents = await auditManager.queryEvents({
      workspaceId: "yartrader",
      taskId: "cmd_persian_1",
    });
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(auditEvents[0].payload.rawCommandText).toBe(realPersianCommand);
  });

  it("2. Real Owner command handoff executes through RealWorldAssistant runtime when SAFE", async () => {
    policyEngine.setRule("mock_command_tool", "SAFE");

    const input: OwnerCommandInput = {
      commandId: "cmd_handoff_safe",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      rawCommandText: realPersianCommand,
      targetCapability: "software-development",
      requestedToolId: "mock_command_tool",
      params: { action: "design_chat_interface" },
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input, mockContext);

    expect(result.accepted).toBe(true);
    expect(result.assistantResult).toBeDefined();
    expect(result.assistantResult?.success).toBe(true);
    expect(result.assistantResult?.executedSteps[0].status).toBe("EXECUTED");
    expect(mockTool.invocations.length).toBe(1);

    const auditEvents = await auditManager.queryEvents({
      workspaceId: "yartrader",
      taskId: "cmd_handoff_safe",
    });
    expect(auditEvents.length).toBeGreaterThan(1);
    const completedEvt = auditEvents.find((e) => e.type === "ACTION_COMPLETED");
    expect(completedEvt).toBeDefined();
  });

  it("3. Real Owner command handoff stops at APPROVAL_REQUIRED without executing tool", async () => {
    policyEngine.setRule("mock_command_tool", "APPROVAL_REQUIRED");

    const input: OwnerCommandInput = {
      commandId: "cmd_handoff_app",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: realPersianCommand,
      targetCapability: "software-development",
      requestedToolId: "mock_command_tool",
      params: { action: "deploy_chat_interface" },
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input, mockContext);

    expect(result.accepted).toBe(true);
    expect(result.assistantResult).toBeDefined();
    expect(result.assistantResult?.success).toBe(false);
    expect(result.assistantResult?.executedSteps[0].status).toBe(
      "APPROVAL_REQUIRED",
    );
    expect(mockTool.invocations.length).toBe(0); // Tool NEVER executed

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
      taskId: "cmd_handoff_app",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("APPROVAL_REQUIRED");
  });

  it("4. Missing ownerId context fails closed", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_no_owner",
      ownerId: "",
      workspaceId: "yartrader",
      rawCommandText: realPersianCommand,
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("Missing owner context");
  });

  it("5. Owner profile mismatch fails closed", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_wrong_owner",
      ownerId: "unauthorized_user",
      workspaceId: "yartrader",
      rawCommandText: realPersianCommand,
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("Owner context mismatch");
  });

  it("6. Missing workspaceId context fails closed", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_no_ws",
      ownerId: "owner_sohrab",
      workspaceId: "",
      rawCommandText: realPersianCommand,
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("Missing workspace context");
  });

  it("7. Malformed or empty command text fails closed", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_empty_text",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: "   ",
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("Malformed or empty command text");
  });

  it("8. Conversational Persian greeting 'سلام' handles conversationally without tool execution or PolicyEngine block", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_greeting_persian",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: "سلام",
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(true);
    expect(result.resolvedCapability).toBe("conversation");
    expect(result.resolvedToolId).toBeUndefined();
    expect(result.assistantResult?.success).toBe(true);
    expect(result.assistantResult?.executedSteps.length).toBe(0); // ZERO tool steps executed
    expect(result.assistantResult?.evidence?.summary).toContain("سلام");
    expect(mockTool.invocations.length).toBe(0); // Tool NEVER invoked
  });

  it("9. Conversational English greeting 'hello' handles conversationally without tool execution", async () => {
    const input: OwnerCommandInput = {
      commandId: "cmd_greeting_english",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: "hello",
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input);

    expect(result.accepted).toBe(true);
    expect(result.resolvedCapability).toBe("conversation");
    expect(result.resolvedToolId).toBeUndefined();
    expect(result.assistantResult?.success).toBe(true);
    expect(result.assistantResult?.executedSteps.length).toBe(0);
    expect(mockTool.invocations.length).toBe(0);
  });

  it("10. Operational natural-language command is NOT classified as conversational and routes through execution pipeline", async () => {
    policyEngine.setRule("mock_command_tool", "SAFE");

    const input: OwnerCommandInput = {
      commandId: "cmd_operational_check",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      rawCommandText: "وضعیت repository YarTrader را بررسی کن",
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input, mockContext);

    expect(result.accepted).toBe(true);
    expect(result.resolvedCapability).toBe("software-development"); // Operational capability
    expect(result.resolvedToolId).toBe("mock_command_tool"); // Resolved tool
    expect(result.assistantResult?.executedSteps[0].status).toBe("EXECUTED");
    expect(mockTool.invocations.length).toBe(1); // Executed through tool pipeline
  });

  it("11. Unclassified/blocked tool in operational command fails closed under PolicyEngine", async () => {
    policyEngine.setRule("mock_command_tool", "BLOCKED");

    const input: OwnerCommandInput = {
      commandId: "cmd_operational_blocked",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      rawCommandText: "وضعیت repository YarTrader را بررسی کن",
      timestamp: new Date().toISOString(),
    };

    const result = await receiver.receiveCommand(input, mockContext);

    expect(result.accepted).toBe(true);
    expect(result.resolvedCapability).toBe("software-development");
    expect(result.resolvedToolId).toBe("mock_command_tool");
    expect(result.assistantResult?.success).toBe(false);
    expect(result.assistantResult?.executedSteps[0].status).toBe("BLOCKED"); // Fails closed
    expect(mockTool.invocations.length).toBe(0);
  });
});
