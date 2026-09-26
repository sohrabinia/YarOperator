import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperatorWebServer } from "../src/web/server.js";
import { OperatorApiHandler } from "../src/api/operator.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import { WorkspacePolicy } from "../src/core/workspace/policy.js";
import { Tool, ToolResult } from "../src/core/contracts/index.js";

// Helper function mimicking the exact renderOperatorResponse logic in src/web/public/app.js
function simulateAppJsRenderer(result: any): {
  headerStatus: string;
  primaryText: string;
  codeBlockContent?: string;
} {
  const status = result.status || "SAFE";

  let stepResult: any = undefined;
  let stepError: string | undefined = undefined;

  if (
    result.details &&
    Array.isArray(result.details.executedSteps) &&
    result.details.executedSteps.length > 0
  ) {
    const lastStep =
      result.details.executedSteps[result.details.executedSteps.length - 1];
    if (lastStep) {
      stepResult = lastStep.result;
      stepError = lastStep.error;
    }
  }

  if (stepResult === undefined && result.details && result.details.evidence) {
    if (result.details.evidence.toolResult !== undefined) {
      stepResult = result.details.evidence.toolResult;
    } else if (result.details.evidence.summary !== undefined) {
      stepResult = result.details.evidence.summary;
    }
  }

  // Unwrap toolResult if stepResult is an evidence envelope object
  if (
    stepResult &&
    typeof stepResult === "object" &&
    "toolResult" in stepResult
  ) {
    stepResult = stepResult.toolResult;
  }

  // Determine if meaningful step result exists beyond simple success boolean envelope
  let hasActualResult = stepResult !== undefined && stepResult !== null;
  if (hasActualResult && typeof stepResult === "object") {
    const keys = Object.keys(stepResult);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === "success")) {
      hasActualResult = false;
    }
  }

  let textOutput = "";

  if (
    result.resolvedCapability === "conversation" &&
    result.details &&
    result.details.evidence &&
    result.details.evidence.summary
  ) {
    textOutput = result.details.evidence.summary;
  } else if (status === "COMPLETED") {
    if (typeof stepResult === "string" && stepResult.trim().length > 0) {
      textOutput = stepResult;
    } else if (hasActualResult) {
      textOutput = "اقدام درخواستی با موفقیت انجام شد:";
    } else {
      textOutput = "حتماً. اقدام درخواستی با موفقیت انجام شد.";
    }
  } else if (status === "APPROVAL_REQUIRED") {
    const reason =
      stepError ||
      result.details?.error ||
      result.reason ||
      "برای انجام این اقدام به تأیید شما نیاز دارم. فعلاً متوقف می‌مانم.";
    textOutput = `نیازمند تأیید: ${reason}`;
  } else if (status === "BLOCKED") {
    const reason =
      stepError ||
      result.details?.error ||
      result.reason ||
      "این اقدام در محدوده اختیار فعلی من نیست و اجازه اجرای آن را ندارم.";
    textOutput = `اقدام مسدود شد: ${reason}`;
  } else if (status === "FAILED") {
    const errorMsg =
      stepError ||
      result.details?.error ||
      result.reason ||
      "در اجرای درخواست مشکلی پیش آمد و اقدام انجام نشد.";
    textOutput = `خطا در اجرای اقدام: ${errorMsg}`;
  } else {
    textOutput = "درخواست شما دریافت شد و بررسی گردید.";
  }

  let codeBlockContent: string | undefined = undefined;

  if (hasActualResult) {
    if (typeof stepResult === "object") {
      codeBlockContent = JSON.stringify(stepResult, null, 2);
    } else if (
      typeof stepResult === "number" ||
      typeof stepResult === "boolean"
    ) {
      codeBlockContent = String(stepResult);
    } else if (
      typeof stepResult === "string" &&
      textOutput !== stepResult &&
      stepResult.trim().length > 0
    ) {
      codeBlockContent = stepResult;
    }
  }

  return {
    headerStatus: status,
    primaryText: textOutput,
    codeBlockContent,
  };
}

class TestMockTool implements Tool {
  constructor(
    public metadata: {
      id: string;
      name: string;
      description: string;
      safetyLevel: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
    },
    private handler: (params: any) => Promise<ToolResult>,
  ) {}

  async execute(params: any): Promise<ToolResult> {
    return this.handler(params);
  }
}

function registerMockToolInApp(
  apiHandler: OperatorApiHandler,
  tool: Tool,
  capability: string,
) {
  const ecosystem = (apiHandler as any).commandReceiver?.toolEcosystem;
  const policy = (apiHandler as any).commandReceiver?.policyEngine;
  const registry = (apiHandler as any).commandReceiver?.orchestrator?.registry;
  const wsPolicyManager = (ecosystem as any)?.workspacePolicyManager;
  const envManager = (ecosystem as any)?.environmentManager;

  ecosystem.registerTool(tool);
  policy.setRule(tool.metadata.id, tool.metadata.safetyLevel);

  const wsPolicy = wsPolicyManager?.getPolicy("yartrader");
  if (wsPolicy && !(wsPolicy as any).config.allowedTools.includes(tool.metadata.id)) {
    (wsPolicy as any).config.allowedTools.push(tool.metadata.id);
  }

  const env = envManager?.getEnvironment("env_yartrader");
  if (env && !env.capabilities.includes(tool.metadata.id)) {
    env.capabilities.push(tool.metadata.id);
  }

  registry.registerAgent({
    id: `agent_${tool.metadata.id}`,
    name: `Agent for ${tool.metadata.id}`,
    capabilities: [capability],
    workspaceScopes: ["yartrader"],
    toolScopes: [tool.metadata.id],
    provider: "LocalProvider",
    model: "local-v1",
    contract: { inputSchema: {}, outputSchema: {} },
    available: true,
  });
}

describe("Generic Operator Result Reporting Pipeline Test Suite", () => {
  let server: OperatorWebServer;
  let baseUrl: string;
  let apiHandler: OperatorApiHandler;
  const token = "bearer-token-reporting-pipeline-123";

  beforeEach(async () => {
    apiHandler = await bootstrapOperatorApplication({
      ownerId: "owner_sohrab",
      bearerToken: token,
      defaultWorkspaceId: "yartrader",
      useInMemoryStores: true,
      dbPath: ":memory:",
      resourcesPath: "config/resources.example.json",
    });

    const ecosystem = (apiHandler as any).commandReceiver?.toolEcosystem;
    const policy = (apiHandler as any).commandReceiver?.policyEngine;
    const wsPolicyManager = (ecosystem as any)?.workspacePolicyManager;
    const envManager = (ecosystem as any)?.environmentManager;

    if (policy) {
      policy.setRule("operator_health", "SAFE");
      policy.setRule("operator_health:check", "SAFE");
    }

    const wsPolicy = wsPolicyManager?.getPolicy("yartrader");
    if (wsPolicy && !wsPolicy.getAllowedTools().includes("*")) {
      (wsPolicy as any).config.allowedTools.push("*");
    }

    const env = envManager?.getEnvironment("env_yartrader");
    if (env && !env.capabilities.includes("operator_health")) {
      env.capabilities.push("operator_health");
    }

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      corsOrigin: "http://127.0.0.1:3000",
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

  it("A. Structured successful Tool propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_structured",
        name: "Mock Structured Tool",
        description: "Returns structured object output",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: { foo: "bar", status: "READY", count: 42 },
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_structured");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "بررسی کن mock_structured",
        targetCapability: "cap_mock_structured",
        requestedToolId: "mock_structured",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.status).toBe("COMPLETED");

    const executedStep = data.result.details.executedSteps[0];
    expect(executedStep.status).toBe("EXECUTED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("COMPLETED");
    expect(rendered.primaryText).toBe("اقدام درخواستی با موفقیت انجام شد:");
    expect(rendered.codeBlockContent).toContain('"foo": "bar"');
    expect(rendered.codeBlockContent).toContain('"status": "READY"');
    expect(rendered.codeBlockContent).toContain('"count": 42');
  });

  it("B. Plain-text successful Tool propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_plaintext",
        name: "Mock Plaintext Tool",
        description: "Returns plain text string output",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: "Git operation completed successfully. Clean working tree.",
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_plaintext");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_plaintext",
        targetCapability: "cap_mock_plaintext",
        requestedToolId: "mock_plaintext",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("COMPLETED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.primaryText).toBe(
      "Git operation completed successfully. Clean working tree.",
    );
    expect(rendered.codeBlockContent).toBeUndefined();
  });

  it("C. Array result propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_array",
        name: "Mock Array Tool",
        description: "Returns array output",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: ["item_alpha", "item_beta", "item_gamma"],
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_array");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "بررسی کن mock_array",
        targetCapability: "cap_mock_array",
        requestedToolId: "mock_array",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("COMPLETED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.primaryText).toBe("اقدام درخواستی با موفقیت انجام شد:");
    expect(rendered.codeBlockContent).toContain('"item_alpha"');
    expect(rendered.codeBlockContent).toContain('"item_beta"');
  });

  it("D. Primitive result propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_primitive",
        name: "Mock Primitive Tool",
        description: "Returns number primitive output",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: 100,
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_primitive");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_primitive",
        targetCapability: "cap_mock_primitive",
        requestedToolId: "mock_primitive",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("COMPLETED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.primaryText).toBe("اقدام درخواستی با موفقیت انجام شد:");
    expect(rendered.codeBlockContent).toBe("100");
  });

  it("E. Missing result fallback rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_void",
        name: "Mock Void Tool",
        description: "Returns no output",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: undefined,
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_void");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_void",
        targetCapability: "cap_mock_void",
        requestedToolId: "mock_void",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("COMPLETED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.primaryText).toBe("حتماً. اقدام درخواستی با موفقیت انجام شد.");
    expect(rendered.codeBlockContent).toBeUndefined();
  });

  it("F. Failed Tool error propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_failing",
        name: "Mock Failing Tool",
        description: "Fails execution",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: false,
        error: "Connection timeout while connecting to remote endpoint.",
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_failing");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_failing",
        targetCapability: "cap_mock_failing",
        requestedToolId: "mock_failing",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("FAILED");
    expect(data.result.details.executedSteps[0].error).toContain(
      "Connection timeout",
    );

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("FAILED");
    expect(rendered.primaryText).toContain("خطا در اجرای اقدام:");
    expect(rendered.primaryText).toContain("Connection timeout");
  });

  it("G. BLOCKED command reason propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_blocked",
        name: "Mock Blocked Tool",
        description: "Tool blocked by policy",
        safetyLevel: "BLOCKED",
      },
      async () => ({
        success: false,
        error: "Blocked by policy engine.",
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_blocked");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_blocked",
        targetCapability: "cap_mock_blocked",
        requestedToolId: "mock_blocked",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("BLOCKED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("BLOCKED");
    expect(rendered.primaryText).toContain("اقدام مسدود شد:");
  });

  it("H. APPROVAL_REQUIRED command reason propagation & rendering", async () => {
    const mockTool = new TestMockTool(
      {
        id: "mock_approval",
        name: "Mock Approval Tool",
        description: "Tool requiring owner approval",
        safetyLevel: "APPROVAL_REQUIRED",
      },
      async () => ({
        success: true,
        output: { state: "approved_and_executed" },
      }),
    );

    registerMockToolInApp(apiHandler, mockTool, "cap_mock_approval");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن mock_approval",
        targetCapability: "cap_mock_approval",
        requestedToolId: "mock_approval",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("APPROVAL_REQUIRED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("APPROVAL_REQUIRED");
    expect(rendered.primaryText).toContain("نیازمند تأیید:");
    expect(rendered.primaryText).toContain("mock_approval");
  });

  it("I. UNAVAILABLE Tool handling & rendering", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن unregistered_tool_xyz",
        targetCapability: "cap_unregistered",
        requestedToolId: "unregistered_tool_xyz",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("BLOCKED");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("BLOCKED");
    expect(rendered.primaryText).toContain("اقدام مسدود شد:");
  });

  it("J. Health regression: 'وضعیت سیستم را بررسی کن' returns actual health & readiness values in rendered result", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "وضعیت سیستم را بررسی کن",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.status).toBe("COMPLETED");
    expect(data.result.resolvedToolId).toBe("operator_health");
    expect(data.result.resolvedCapability).toBe("system-monitoring");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("COMPLETED");
    expect(rendered.primaryText).toBe("اقدام درخواستی با موفقیت انجام شد:");
    expect(rendered.codeBlockContent).toContain('"health"');
    expect(rendered.codeBlockContent).toContain('"HEALTHY"');
    expect(rendered.codeBlockContent).toContain('"readiness"');
    expect(rendered.codeBlockContent).toContain('"READY"');
  });

  it("K. Generic non-Health Tool: proves renderer is generic and not health-specific", async () => {
    const mockGitTool = new TestMockTool(
      {
        id: "mock_git_tool_custom",
        name: "Mock Git Tool",
        description: "Executes git commands",
        safetyLevel: "SAFE",
      },
      async () => ({
        success: true,
        output: {
          stdout: "HEAD is at 7cc59a6 Merge pull request #58",
          branch: "main",
          exitCode: 0,
        },
      }),
    );

    registerMockToolInApp(apiHandler, mockGitTool, "cap_mock_git");

    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن git rev-parse HEAD",
        targetCapability: "cap_mock_git",
        requestedToolId: "mock_git_tool_custom",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("COMPLETED");
    expect(data.result.resolvedToolId).toBe("mock_git_tool_custom");

    const rendered = simulateAppJsRenderer(data.result);
    expect(rendered.headerStatus).toBe("COMPLETED");
    expect(rendered.primaryText).toBe("اقدام درخواستی با موفقیت انجام شد:");
    expect(rendered.codeBlockContent).toContain("HEAD is at 7cc59a6 Merge pull request #58");
    expect(rendered.codeBlockContent).toContain('"branch": "main"');
  });
});
