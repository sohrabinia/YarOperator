import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ExecutionEngine,
  ToolRegistry,
  AuditLogger,
  Tool,
  ExecutionContext,
  SecureToolEcosystem,
  PolicyEngine,
  ApprovalManager,
  EnvironmentManager,
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/index.js";

describe("ExecutionEngine Core & Mandatory Security Gate Suite", () => {
  let registry: ToolRegistry;
  let auditLogger: AuditLogger;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let environmentManager: EnvironmentManager;
  let workspacePolicyManager: WorkspacePolicyManager;
  let ecosystem: SecureToolEcosystem;
  let engine: ExecutionEngine;

  const mockContext: ExecutionContext = {
    executionId: "exec_123",
    timestamp: new Date(),
    workspaceId: "yartrader",
    environmentId: "env_yartrader",
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    auditLogger = new AuditLogger();
    approvalManager = new ApprovalManager(":memory:");
    policyEngine = new PolicyEngine(approvalManager);
    environmentManager = new EnvironmentManager();
    workspacePolicyManager = new WorkspacePolicyManager();

    const allowedTools = ["echo_tool", "guarded", "test", "spy_tool"];

    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "yartrader",
        allowedTools,
        allowedRoots: [process.cwd()],
      }),
    );

    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "Default Environment",
      type: "PRODUCTION",
      capabilities: allowedTools,
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    ecosystem = new SecureToolEcosystem(
      registry,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );

    engine = new ExecutionEngine(registry, auditLogger, ecosystem);
  });

  // --- Basic Core Engine Tests ---
  it("should execute a valid registered tool successfully", async () => {
    const echoTool: Tool<{ message: string }, { echoed: string }> = {
      metadata: {
        id: "echo_tool",
        name: "Echo Tool",
        description: "Echoes message",
        safetyLevel: "SAFE",
      },
      execute: async (params) => ({
        success: true,
        output: { echoed: params.message },
      }),
    };

    registry.register(echoTool);
    policyEngine.setRule("echo_tool", "SAFE");

    const result = await engine.execute<
      { message: string },
      { echoed: string }
    >("echo_tool", { message: "hello" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.output?.echoed).toBe("hello");
    expect(engine.getState()).toBe("COMPLETED");

    const events = auditLogger.getEvents("exec_123");
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toContain("STEP_START");
    expect(events.map((e) => e.type)).toContain("STEP_END");
  });

  it("should fail gracefully when executing an unknown tool", async () => {
    const result = await engine.execute("unknown_tool", {}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool 'unknown_tool' is not registered");
    expect(engine.getState()).toBe("FAILED");
  });

  it("should reject duplicate tool registrations", () => {
    const dummyTool: Tool = {
      metadata: {
        id: "test",
        name: "test",
        description: "test",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true }),
    };

    registry.register(dummyTool);
    expect(() => registry.register(dummyTool)).toThrow("already registered");
  });

  // --- Mandatory Security Regression Tests (Section 7) ---
  describe("Section 7 Mandatory Security Regression Tests", () => {
    it("Test 1 — ExecutionEngine routes tool execution through SecureToolEcosystem -> Tool", async () => {
      const executeSpy = vi
        .fn()
        .mockResolvedValue({ success: true, output: "ok" });
      const spyTool: Tool = {
        metadata: {
          id: "spy_tool",
          name: "Spy",
          description: "Spy",
          safetyLevel: "SAFE",
        },
        execute: executeSpy,
      };
      registry.register(spyTool);
      policyEngine.setRule("spy_tool", "SAFE");

      const res = await engine.execute("spy_tool", {}, mockContext);
      expect(res.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it("Test 2 — ExecutionEngine without SecureToolEcosystem fails closed", async () => {
      const bareEngine = new ExecutionEngine(registry, auditLogger);
      const res = await bareEngine.execute("echo_tool", {}, mockContext);
      expect(res.success).toBe(false);
      expect(res.error).toContain(
        "Authoritative SecureToolEcosystem is required",
      );
    });

    it("Test 3 — Legacy PolicyEvaluator saying allowed=true for unknown action is BLOCKED by authoritative ecosystem", async () => {
      class UnknownTool implements Tool {
        metadata = {
          id: "guarded",
          name: "Guarded",
          description: "g",
          safetyLevel: "SAFE" as const,
        };
        resolveCanonicalAction() {
          return "guarded:unknown_subaction";
        }
        async execute() {
          return { success: true };
        }
      }
      registry.register(new UnknownTool());

      // Broad tool rule in policyEngine, but unknown subaction must fail closed
      policyEngine.setRule("guarded", "SAFE");

      const res = await engine.execute(
        "guarded",
        { action: "unknown_subaction" },
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain(
        "unclassified or ambiguous and defaults to BLOCKED",
      );
    });

    it("Test 4 — Unknown action fails closed as BLOCKED without calling tool.execute()", async () => {
      const executeSpy = vi.fn().mockResolvedValue({ success: true });
      class UnknownActionTool implements Tool {
        metadata = {
          id: "guarded",
          name: "G",
          description: "d",
          safetyLevel: "SAFE" as const,
        };
        resolveCanonicalAction() {
          return "guarded:unclassified";
        }
        execute = executeSpy;
      }
      registry.register(new UnknownActionTool());

      const res = await engine.execute("guarded", {}, mockContext);
      expect(res.success).toBe(false);
      expect(res.error).toContain("BLOCKED");
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it("Test 5 — Missing approval on APPROVAL_REQUIRED action fails closed", async () => {
      const executeSpy = vi.fn().mockResolvedValue({ success: true });
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: executeSpy,
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const res = await engine.execute("guarded", { key: "val" }, mockContext);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Approval check failed");
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it("Test 6 — Exact approval allows execution exactly once", async () => {
      const executeSpy = vi
        .fn()
        .mockResolvedValue({ success: true, output: "done" });
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: executeSpy,
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const params = { key: "val" };
      const appReq = approvalManager.requestApproval(
        "guarded",
        params,
        300000,
        "yartrader",
        "env_yartrader",
        "guarded",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const res = await engine.execute("guarded", params, mockContext);
      expect(res.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it("Test 7 — Parameter mutation fails closed", async () => {
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: async () => ({ success: true }),
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const params = { key: "original" };
      const appReq = approvalManager.requestApproval(
        "guarded",
        params,
        300000,
        "yartrader",
        "env_yartrader",
        "guarded",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      // Attempt executing with mutated parameter
      const res = await engine.execute(
        "guarded",
        { key: "mutated" },
        mockContext,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain("Approval check failed");
    });

    it("Test 8 — Workspace mutation fails closed", async () => {
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: async () => ({ success: true }),
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const params = { key: "val" };
      const appReq = approvalManager.requestApproval(
        "guarded",
        params,
        300000,
        "yartrader",
        "env_yartrader",
        "guarded",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const mutatedContext: ExecutionContext = {
        ...mockContext,
        workspaceId: "other_workspace",
      };
      const res = await engine.execute("guarded", params, mutatedContext);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(
        /not authorized for workspace|Approval check failed/,
      );
    });

    it("Test 9 — Environment mutation fails closed", async () => {
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: async () => ({ success: true }),
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const params = { key: "val" };
      const appReq = approvalManager.requestApproval(
        "guarded",
        params,
        300000,
        "yartrader",
        "env_yartrader",
        "guarded",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const mutatedContext: ExecutionContext = {
        ...mockContext,
        environmentId: "env_other",
      };
      const res = await engine.execute("guarded", params, mutatedContext);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(
        /not registered in EnvironmentManager|Approval check failed/,
      );
    });

    it("Test 10 — Approval replay fails closed on second execution", async () => {
      const guardedTool: Tool = {
        metadata: {
          id: "guarded",
          name: "G",
          description: "g",
          safetyLevel: "APPROVAL_REQUIRED",
        },
        execute: async () => ({ success: true }),
      };
      registry.register(guardedTool);
      policyEngine.setRule("guarded", "APPROVAL_REQUIRED");

      const params = { key: "val" };
      const appReq = approvalManager.requestApproval(
        "guarded",
        params,
        300000,
        "yartrader",
        "env_yartrader",
        "guarded",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const res1 = await engine.execute("guarded", params, mockContext);
      expect(res1.success).toBe(true);

      // Replay attempt
      const res2 = await engine.execute("guarded", params, mockContext);
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("replay attack protection");
    });
  });
});
