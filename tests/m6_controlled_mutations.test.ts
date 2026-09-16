import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SecureToolEcosystem,
  PolicyEngine,
  ApprovalManager,
  EnvironmentManager,
  WorkspacePolicyManager,
  WorkspacePolicy,
  BrowserTool,
  GitTool,
  GitHubTool,
  TerminalTool,
  ExecutionContext,
  ExecutionScope,
  BrowserDriver,
  ExecutionEngine,
  AuditLogger,
  Tool,
} from "../src/index.js";

describe("M6 Controlled Mutations Security Gate Suite", () => {
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let environmentManager: EnvironmentManager;
  let workspacePolicyManager: WorkspacePolicyManager;
  let ecosystem: SecureToolEcosystem;

  const defaultWorkspaceId = "yartrader";
  const defaultEnvironmentId = "env_yartrader";

  const scope: ExecutionScope = {
    id: "scope_m6",
    workspaceId: defaultWorkspaceId,
    agentId: "m6_agent",
    allowedCapabilities: [
      "browser_operate",
      "git_operate",
      "github_operate",
      "terminal_execute",
      "spy_tool",
    ],
    allowedTools: [
      "browser_operate",
      "git_operate",
      "github_operate",
      "terminal_execute",
      "spy_tool",
    ],
    maxRetries: 1,
  };

  const context: ExecutionContext = {
    executionId: "exec_m6_test",
    timestamp: new Date(),
    workspaceId: defaultWorkspaceId,
    environmentId: defaultEnvironmentId,
  };

  beforeEach(() => {
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    environmentManager = new EnvironmentManager();
    workspacePolicyManager = new WorkspacePolicyManager();

    ecosystem = new SecureToolEcosystem(
      undefined,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );

    const tools = [
      "browser_operate",
      "git_operate",
      "github_operate",
      "terminal_execute",
      "spy_tool",
    ];

    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: defaultWorkspaceId,
        allowedTools: tools,
        allowedRoots: [process.cwd()],
      }),
    );

    environmentManager.registerEnvironment({
      id: defaultEnvironmentId,
      name: "Production Env",
      type: "PRODUCTION",
      capabilities: tools,
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: defaultWorkspaceId },
    });

    // Canonical action rules
    policyEngine.setRule("browser_operate:navigate", "SAFE");
    policyEngine.setRule("browser_operate:click", "APPROVAL_REQUIRED");
    policyEngine.setRule("browser_operate:fill", "APPROVAL_REQUIRED");

    policyEngine.setRule("git_operate:status", "SAFE");
    policyEngine.setRule("git_operate:diff", "SAFE");
    policyEngine.setRule("git_operate:branch_list", "SAFE");
    policyEngine.setRule("git_operate:branch_create", "APPROVAL_REQUIRED");
    policyEngine.setRule("git_operate:branch_delete", "APPROVAL_REQUIRED");
    policyEngine.setRule("git_operate:commit", "APPROVAL_REQUIRED");
    policyEngine.setRule("git_operate:checkout", "APPROVAL_REQUIRED");
    policyEngine.setRule("git_operate:push", "APPROVAL_REQUIRED");

    policyEngine.setRule("github_operate:get_pr", "SAFE");
    policyEngine.setRule("github_operate:create_pr", "APPROVAL_REQUIRED");
    policyEngine.setRule("github_operate:merge_pr", "BLOCKED");

    policyEngine.setRule("terminal_execute:run", "APPROVAL_REQUIRED");
  });

  describe("1. Canonical Action Identity & Resolution", () => {
    it("resolves browser actions correctly", () => {
      const tool = new BrowserTool();
      expect(
        tool.resolveCanonicalAction({
          url: "https://x.com",
          action: "navigate",
        }),
      ).toBe("browser_operate:navigate");
      expect(
        tool.resolveCanonicalAction({ url: "https://x.com", action: "click" }),
      ).toBe("browser_operate:click");
      expect(
        tool.resolveCanonicalAction({ url: "https://x.com", action: "fill" }),
      ).toBe("browser_operate:fill");
    });

    it("resolves git actions correctly", () => {
      const tool = new GitTool();
      expect(tool.resolveCanonicalAction({ action: "status" })).toBe(
        "git_operate:status",
      );
      expect(tool.resolveCanonicalAction({ action: "diff" })).toBe(
        "git_operate:diff",
      );
      expect(tool.resolveCanonicalAction({ action: "branch" })).toBe(
        "git_operate:branch_list",
      );
      expect(
        tool.resolveCanonicalAction({ action: "branch", branch: "feat" }),
      ).toBe("git_operate:branch_create");
      expect(
        tool.resolveCanonicalAction({ action: "commit", message: "m" }),
      ).toBe("git_operate:commit");
      expect(tool.resolveCanonicalAction({ action: "push" })).toBe(
        "git_operate:push",
      );
    });

    it("resolves github actions correctly", () => {
      const tool = new GitHubTool();
      expect(
        tool.resolveCanonicalAction({ action: "get_pr", prNumber: 1 }),
      ).toBe("github_operate:get_pr");
      expect(
        tool.resolveCanonicalAction({
          action: "create_pr",
          title: "t",
          head: "h",
        }),
      ).toBe("github_operate:create_pr");
      expect(
        tool.resolveCanonicalAction({ action: "merge_pr", prNumber: 1 }),
      ).toBe("github_operate:merge_pr");
    });

    it("fails closed for unclassified / unknown actions", async () => {
      class UnclassifiedTool implements Tool {
        metadata = {
          id: "spy_tool",
          name: "Spy Tool",
          description: "Spy",
          safetyLevel: "SAFE" as const,
        };
        resolveCanonicalAction() {
          return "spy_tool:unknown_action";
        }
        async execute() {
          return { success: true };
        }
      }

      ecosystem.registerTool(new UnclassifiedTool());

      const res = await ecosystem.execute("spy_tool", {}, scope, context);
      expect(res.success).toBe(false);
      expect(res.error).toContain(
        "unclassified or ambiguous and defaults to BLOCKED",
      );
    });
  });

  describe("2. Policy Evaluation & Separation", () => {
    it("permits SAFE operations without approval", async () => {
      const mockDriver: BrowserDriver = {
        navigate: async () => ({ title: "Test", contentSnippet: "snippet" }),
        close: async () => {},
      };
      ecosystem.registerTool(new BrowserTool(async () => mockDriver));

      const res = await ecosystem.execute(
        "browser_operate",
        { url: "https://example.com", action: "navigate" },
        scope,
        context,
      );

      expect(res.success).toBe(true);
    });

    it("rejects BLOCKED operations always (github_operate:merge_pr)", async () => {
      ecosystem.registerTool(new GitHubTool());

      // Request approval to verify even approved BLOCKED actions are rejected
      const appReq = approvalManager.requestApproval(
        "github_operate:merge_pr",
        { action: "merge_pr", prNumber: 123 },
        300000,
        defaultWorkspaceId,
        defaultEnvironmentId,
        "github_operate:merge_pr",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const res = await ecosystem.execute(
        "github_operate",
        { action: "merge_pr", prNumber: 123 },
        scope,
        context,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("BLOCKED");
    });
  });

  describe("3. Context-Bound Approval & Fingerprinting", () => {
    it("succeeds with valid approval bound to params, action, workspace, and environment", async () => {
      const mockDriver: BrowserDriver = {
        navigate: async () => ({ title: "Test", contentSnippet: "snippet" }),
        click: async () => {},
        close: async () => {},
      };
      ecosystem.registerTool(new BrowserTool(async () => mockDriver));

      const params = {
        url: "https://example.com",
        action: "click" as const,
        selector: "#btn",
      };

      const appReq = approvalManager.requestApproval(
        "browser_operate",
        params,
        300000,
        defaultWorkspaceId,
        defaultEnvironmentId,
        "browser_operate:click",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const res = await ecosystem.execute(
        "browser_operate",
        params,
        scope,
        context,
      );

      expect(res.success).toBe(true);
    });

    it("rejects when parameters mutate after approval", async () => {
      ecosystem.registerTool(new TerminalTool());

      const params = { command: "echo", args: ["hello"] };
      const appReq = approvalManager.requestApproval(
        "terminal_execute",
        params,
        300000,
        defaultWorkspaceId,
        defaultEnvironmentId,
        "terminal_execute:run",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      // Mutated parameter: args changed to ["malicious"]
      const res = await ecosystem.execute(
        "terminal_execute",
        { command: "echo", args: ["malicious"] },
        scope,
        context,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("No approval request found for fingerprint");
    });

    it("rejects when workspace or environment mutates", async () => {
      environmentManager.registerEnvironment({
        id: "env_different",
        name: "Different Env",
        type: "PRODUCTION",
        capabilities: ["terminal_execute"],
        accessScope: "workspace",
        riskLevel: "SAFE",
        healthy: true,
        metadata: { workspaceId: defaultWorkspaceId },
      });

      ecosystem.registerTool(new TerminalTool());

      const params = { command: "echo", args: ["test"] };
      const appReq = approvalManager.requestApproval(
        "terminal_execute",
        params,
        300000,
        defaultWorkspaceId,
        defaultEnvironmentId,
        "terminal_execute:run",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      // Environment mutation
      const mutatedContext: ExecutionContext = {
        ...context,
        environmentId: "env_different",
      };

      const res = await ecosystem.execute(
        "terminal_execute",
        params,
        scope,
        mutatedContext,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Approval check failed");
    });

    it("rejects token replay / consumed token", async () => {
      const mockDriver: BrowserDriver = {
        navigate: async () => ({ title: "Test", contentSnippet: "snippet" }),
        click: async () => {},
        close: async () => {},
      };
      ecosystem.registerTool(new BrowserTool(async () => mockDriver));

      const params = {
        url: "https://example.com",
        action: "click" as const,
        selector: "#btn",
      };

      const appReq = approvalManager.requestApproval(
        "browser_operate",
        params,
        300000,
        defaultWorkspaceId,
        defaultEnvironmentId,
        "browser_operate:click",
      );
      approvalManager.grantApproval(appReq.id, "owner_sohrab");

      const firstExec = await ecosystem.execute(
        "browser_operate",
        params,
        scope,
        context,
      );
      expect(firstExec.success).toBe(true);

      // Second execution attempt with same consumed approval token
      const secondExec = await ecosystem.execute(
        "browser_operate",
        params,
        scope,
        context,
      );
      expect(secondExec.success).toBe(false);
      expect(secondExec.error).toContain("replay attack protection");
    });
  });

  describe("4. Authoritative Execution Gate Guarantee", () => {
    it("guarantees tool.execute() is NEVER called if gate rejects request", async () => {
      const executeSpy = vi.fn().mockResolvedValue({ success: true });

      class SpyTool implements Tool {
        metadata = {
          id: "spy_tool",
          name: "Spy Tool",
          description: "Spy",
          safetyLevel: "APPROVAL_REQUIRED" as const,
        };
        resolveCanonicalAction() {
          return "spy_tool:action";
        }
        execute = executeSpy;
      }

      ecosystem.registerTool(new SpyTool());
      policyEngine.setRule("spy_tool:action", "APPROVAL_REQUIRED");

      // No approval provided -> Gate must reject
      const res = await ecosystem.execute("spy_tool", {}, scope, context);

      expect(res.success).toBe(false);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it("invokes tool.execute() exactly once on successful gate authorization", async () => {
      const executeSpy = vi
        .fn()
        .mockResolvedValue({ success: true, output: "done" });

      class SpyTool implements Tool {
        metadata = {
          id: "spy_tool",
          name: "Spy Tool",
          description: "Spy",
          safetyLevel: "SAFE" as const,
        };
        resolveCanonicalAction() {
          return "spy_tool:action";
        }
        execute = executeSpy;
      }

      ecosystem.registerTool(new SpyTool());
      policyEngine.setRule("spy_tool:action", "SAFE");

      const res = await ecosystem.execute("spy_tool", {}, scope, context);

      expect(res.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("5. Execution Bypass Elimination", () => {
    it("enforces gate checks when executed via ExecutionEngine", async () => {
      const registry = ecosystem.getRegistry();
      const auditLogger = new AuditLogger();
      const engine = new ExecutionEngine(
        registry,
        auditLogger,
        policyEngine,
        ecosystem,
      );

      // Attempt to execute BLOCKED action via ExecutionEngine
      ecosystem.registerTool(new GitHubTool());

      const res = await engine.execute(
        "github_operate",
        { action: "merge_pr", prNumber: 99 },
        context,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("BLOCKED");
    });
  });
});
