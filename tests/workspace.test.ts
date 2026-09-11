import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkspaceManager,
  WorkspacePolicy,
  WorkspacePolicyManager,
  RuntimeContext,
  WorkspaceConfig,
  GitTool,
  ExecutionContext,
  SecureToolEcosystem,
  ToolRegistry,
  EnvironmentManager,
  Tool,
  ToolResult,
  ExecutionScope,
} from "../src/index.js";
import { resolve, join } from "path";

class SpyTool implements Tool {
  public executeCount = 0;

  constructor(
    public metadata = {
      id: "spy_tool",
      name: "Spy Tool",
      description: "Test tool with execution counter spy",
      safetyLevel: "SAFE" as const,
    },
  ) {}

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.executeCount++;
    return {
      success: true,
      output: { executeCount: this.executeCount, params },
    };
  }
}

describe("WorkspaceManager and RuntimeContext Foundation", () => {
  let workspaceManager: WorkspaceManager;

  beforeEach(() => {
    workspaceManager = new WorkspaceManager();
  });

  it("should register, retrieve, and list workspaces", () => {
    const config: WorkspaceConfig = {
      id: "yartrader",
      name: "YarTrader Workspace",
      description: "Trading and execution workspace",
      goals: ["Maintain trading algorithms", "Execute tests"],
      permissions: {
        allowedActions: ["git_operate", "terminal_execute"],
        restrictedActions: ["rm -rf"],
      },
    };

    workspaceManager.registerWorkspace(config);

    expect(workspaceManager.hasWorkspace("yartrader")).toBe(true);
    const retrieved = workspaceManager.getWorkspace("yartrader");
    expect(retrieved?.name).toBe("YarTrader Workspace");
    expect(workspaceManager.listWorkspaces().length).toBe(1);
  });

  it("should throw error when registering workspace without id or name", () => {
    expect(() =>
      workspaceManager.registerWorkspace({ id: "", name: "" } as any),
    ).toThrow("Workspace requires valid id and name");
  });

  it("should construct valid runtime context", () => {
    const context: RuntimeContext = {
      id: "ctx_123",
      user: { id: "user_1", name: "Owner", role: "Owner" },
      workspace: { workspaceId: "yartrader", name: "YarTrader Workspace" },
      goal: "Run daily trading status check",
      mode: "development",
      permissions: { allowedActions: ["read"], restrictedActions: ["write"] },
      constraints: { maxRiskLevel: "APPROVAL_REQUIRED" },
      priority: "high",
      createdAt: new Date(),
    };

    expect(context.workspace.workspaceId).toBe("yartrader");
    expect(context.mode).toBe("development");
    expect(context.priority).toBe("high");
  });
});

describe("WorkspacePolicy Execution Boundary Required Regression Matrix (Cases A-G)", () => {
  let registry: ToolRegistry;
  let spyTool: SpyTool;
  let mockScope: ExecutionScope;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    spyTool = new SpyTool();
    registry.register(spyTool);

    mockScope = {
      workspaceId: "yartrader",
      allowedTools: ["spy_tool"],
    } as any;

    mockContext = {
      executionId: "exec_ws_matrix_test",
      timestamp: new Date(),
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
    };
  });

  it("CASE A: WorkspacePolicyManager missing => DENY => executeCount === 0", async () => {
    const ecosystem = new SecureToolEcosystem(registry);

    const res = await ecosystem.execute("spy_tool", {}, mockScope, mockContext);

    expect(res.success).toBe(false);
    expect(res.error).toContain("WorkspacePolicyManager missing");
    expect(spyTool.executeCount).toBe(0);
  });

  it("CASE B: workspaceId missing => DENY => executeCount === 0", async () => {
    const policyManager = new WorkspacePolicyManager();
    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const emptyScope = { ...mockScope, workspaceId: "" } as any;
    const emptyContext = { ...mockContext, workspaceId: "" } as any;

    const res = await ecosystem.execute(
      "spy_tool",
      {},
      emptyScope,
      emptyContext,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Missing workspaceId");
    expect(spyTool.executeCount).toBe(0);
  });

  it("CASE C: workspace policy missing => DENY => executeCount === 0", async () => {
    const policyManager = new WorkspacePolicyManager();
    // Register policy for a different workspace
    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "other_workspace",
        allowedTools: ["spy_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const res = await ecosystem.execute("spy_tool", {}, mockScope, mockContext);

    expect(res.success).toBe(false);
    expect(res.error).toContain("No WorkspacePolicy registered");
    expect(spyTool.executeCount).toBe(0);
  });

  it("CASE D: registered policy + allowed tool => ALLOW => Tool.execute() called", async () => {
    const policyManager = new WorkspacePolicyManager();
    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const res = await ecosystem.execute("spy_tool", {}, mockScope, mockContext);

    expect(res.success).toBe(true);
    expect(spyTool.executeCount).toBe(1);
  });

  it("CASE E: registered policy + denied tool => DENY => executeCount === 0", async () => {
    const policyManager = new WorkspacePolicyManager();
    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["other_tool"], // spy_tool is NOT allowed
        allowedRoots: [process.cwd()],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const res = await ecosystem.execute("spy_tool", {}, mockScope, mockContext);

    expect(res.success).toBe(false);
    expect(res.error).toContain("is not permitted by WorkspacePolicy");
    expect(spyTool.executeCount).toBe(0);
  });

  it("CASE F: registered policy + allowed root => ALLOW => Tool.execute() called", async () => {
    const policyManager = new WorkspacePolicyManager();
    const allowedDir = resolve(process.cwd());

    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_tool"],
        allowedRoots: [allowedDir],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const res = await ecosystem.execute(
      "spy_tool",
      { cwd: join(allowedDir, "src") },
      mockScope,
      mockContext,
    );

    expect(res.success).toBe(true);
    expect(spyTool.executeCount).toBe(1);
  });

  it("CASE G: registered policy + denied root => DENY => Tool.execute() NOT called", async () => {
    const policyManager = new WorkspacePolicyManager();
    const allowedDir = resolve(process.cwd());

    policyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools: ["spy_tool"],
        allowedRoots: [allowedDir],
      }),
    );

    const ecosystem = new SecureToolEcosystem(
      registry,
      undefined,
      undefined,
      undefined,
      policyManager,
    );

    const forbiddenPath = resolve("/tmp/outside_root");
    const res = await ecosystem.execute(
      "spy_tool",
      { cwd: forbiddenPath },
      mockScope,
      mockContext,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("outside authorized workspace roots");
    expect(spyTool.executeCount).toBe(0);
  });
});
