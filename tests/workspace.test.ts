import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkspaceManager,
  WorkspacePolicy,
  WorkspacePolicyManager,
  RuntimeContext,
  WorkspaceConfig,
  GitTool,
  ExecutionContext,
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
  });
});
