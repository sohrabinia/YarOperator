import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkspaceManager,
  RuntimeContext,
  WorkspaceConfig,
} from "../src/index.js";

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
