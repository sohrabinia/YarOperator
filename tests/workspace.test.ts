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
} from "../src/index.js";
import { resolve, join } from "path";

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

  describe("WorkspacePolicy Enforcement Boundaries", () => {
    it("Positive: yartrader workspace can execute git status", async () => {
      const gitTool = new GitTool();
      const mockContext: ExecutionContext = {
        executionId: "exec_ws_pos_1",
        timestamp: new Date(),
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
      };

      const result = await gitTool.execute(
        { action: "status", cwd: process.cwd() },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output?.exitCode).toBe(0);
    });

    it("Negative: git cwd outside workspace root is blocked", async () => {
      const gitTool = new GitTool();
      const mockContext: ExecutionContext = {
        executionId: "exec_ws_neg_1",
        timestamp: new Date(),
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
      };

      const outsidePath = resolve(join(process.cwd(), ".."));
      const result = await gitTool.execute(
        { action: "status", cwd: outsidePath },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("escapes authorized workspace root");
    });

    it("Negative: path escaping policy root is rejected by WorkspacePolicy", () => {
      const policy = new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedRoots: ["./src"],
        allowedTools: ["git_operate"],
      });

      const insideCheck = policy.validateRoot("./src/index.ts");
      expect(insideCheck.allowed).toBe(true);

      const outsideCheck = policy.validateRoot("/etc/passwd");
      expect(outsideCheck.allowed).toBe(false);
      expect(outsideCheck.reason).toContain(
        "outside authorized workspace roots",
      );
    });

    it("Negative: unauthorized tool is blocked by WorkspacePolicyManager", () => {
      const manager = new WorkspacePolicyManager();
      const policy = new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedRoots: [process.cwd()],
        allowedTools: ["git_operate"],
      });
      manager.registerPolicy(policy);

      const allowedRes = manager.validateToolAccess("yartrader", "git_operate");
      expect(allowedRes.allowed).toBe(true);

      const blockedRes = manager.validateToolAccess(
        "yartrader",
        "unauthorized_tool",
      );
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.reason).toContain(
        "is not permitted by WorkspacePolicy",
      );
    });

    it("CASE 1 (Test A): Missing policy denies tool access and root access", () => {
      const manager = new WorkspacePolicyManager();
      const toolCheck = manager.validateToolAccess(
        "unregistered_ws",
        "git_operate",
      );
      expect(toolCheck.allowed).toBe(false);
      expect(toolCheck.reason).toContain("No WorkspacePolicy registered");

      const rootCheck = manager.validateRootAccess("unregistered_ws", "./src");
      expect(rootCheck.allowed).toBe(false);
      expect(rootCheck.reason).toContain("No WorkspacePolicy registered");
    });

    it("CASE 2 (Test B): Existing allowed policy permits tool access", () => {
      const manager = new WorkspacePolicyManager();
      const policy = new WorkspacePolicy({
        workspaceId: "ws_allowed",
        allowedRoots: [process.cwd()],
        allowedTools: ["git_operate"],
      });
      manager.registerPolicy(policy);

      const check = manager.validateToolAccess("ws_allowed", "git_operate");
      expect(check.allowed).toBe(true);
    });

    it("CASE 3 (Test C): Existing denied policy blocks tool access", () => {
      const manager = new WorkspacePolicyManager();
      const policy = new WorkspacePolicy({
        workspaceId: "ws_denied",
        allowedRoots: [process.cwd()],
        allowedTools: ["git_operate"],
      });
      manager.registerPolicy(policy);

      const check = manager.validateToolAccess("ws_denied", "terminal_execute");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("is not permitted by WorkspacePolicy");
    });

    it("CASE 4 (Test D): Missing policy must block actual tool execution at SecureToolEcosystem boundary", async () => {
      let executionCount = 0;
      const fakeTool: Tool = {
        metadata: {
          id: "test_tool",
          name: "Test Tool",
          description: "Test execution tool",
          riskLevel: "SAFE",
        },
        async execute(): Promise<ToolResult<unknown>> {
          executionCount++;
          return { success: true, output: "executed" };
        },
      };

      const registry = new ToolRegistry();
      registry.register(fakeTool);

      const envManager = new EnvironmentManager();
      envManager.registerEnvironment({
        id: "env_ws_test",
        name: "Test Env",
        workspaceId: "ws_missing_policy",
        capabilities: ["test_tool"],
        status: "healthy",
      });

      const policyManager = new WorkspacePolicyManager();
      // NO policy registered for 'ws_missing_policy'

      const ecosystem = new SecureToolEcosystem(
        registry,
        undefined,
        undefined,
        envManager,
        policyManager,
      );

      const scope = {
        scopeId: "scope_test",
        workspaceId: "ws_missing_policy",
        allowedTools: ["test_tool"],
        policyRules: [],
      };

      const context: ExecutionContext = {
        executionId: "exec_test_1",
        timestamp: new Date(),
        workspaceId: "ws_missing_policy",
        environmentId: "env_ws_test",
      };

      const result = await ecosystem.execute("test_tool", {}, scope, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No WorkspacePolicy registered");
      expect(executionCount).toBe(0);
    });
  });
});
