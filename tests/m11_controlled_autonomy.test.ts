import { describe, it, expect, beforeEach } from "vitest";
import { IdentityStore } from "../src/core/identity/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager, InMemoryAuditStore } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry, RegisteredAgent } from "../src/core/agent/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";
import { ToolRegistry } from "../src/core/registry/index.js";
import { AcceptanceEngine } from "../src/core/acceptance/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
import {
  Tool,
  ToolResult,
  ToolMetadata,
  ExecutionContext,
} from "../src/core/contracts/index.js";
import {
  ControlledAutonomyEngine,
  BoundedAutonomyRunConfig,
  AutonomyPolicy,
  AIProposal,
  TERMINAL_AUTONOMY_STATES,
} from "../src/core/autonomy/index.js";

class DummyTool implements Tool {
  public metadata: ToolMetadata;

  constructor(
    id: string,
    name: string,
    private handler?: (params: any, context?: ExecutionContext) => Promise<any>,
  ) {
    this.metadata = {
      id,
      name,
      description: `Dummy ${name}`,
      safetyLevel: "SAFE",
    };
  }

  get id(): string {
    return this.metadata.id;
  }

  async execute(params: any, context?: ExecutionContext): Promise<ToolResult> {
    if (this.handler) {
      const res = await this.handler(params, context);
      return { success: true, output: res };
    }
    return {
      success: true,
      output: `Tool ${this.metadata.id} executed successfully`,
    };
  }

  resolveCanonicalAction(params: any): string {
    return (params as any)?.action
      ? `${this.metadata.id}:${(params as any).action}`
      : this.metadata.id;
  }
}

describe("M11 Controlled Autonomy Layer Security & Regression Test Suite", () => {
  let identityStore: IdentityStore;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let environmentManager: EnvironmentManager;
  let workspacePolicyManager: WorkspacePolicyManager;
  let agentRegistry: AgentRegistry;
  let toolRegistry: ToolRegistry;
  let orchestrator: AgentOrchestrator;
  let toolEcosystem: SecureToolEcosystem;
  let acceptanceEngine: AcceptanceEngine;
  let autonomyEngine: ControlledAutonomyEngine;

  let ownerUser: any;
  let validPolicy: AutonomyPolicy;

  beforeEach(() => {
    identityStore = new IdentityStore(":memory:");
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager(new InMemoryAuditStore());
    notificationManager = new NotificationManager();
    environmentManager = new EnvironmentManager();
    workspacePolicyManager = new WorkspacePolicyManager();
    agentRegistry = new AgentRegistry();
    toolRegistry = new ToolRegistry();

    orchestrator = new AgentOrchestrator(
      agentRegistry,
      policyEngine,
      undefined,
      undefined,
    );

    toolEcosystem = new SecureToolEcosystem(
      toolRegistry,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );

    acceptanceEngine = new AcceptanceEngine();

    // Setup Owner User and Workspace in M9 IdentityStore
    ownerUser = identityStore.createUser({
      primaryEmail: "owner@yartrader.com",
      displayName: "Owner User",
    });

    identityStore.createWorkspace({
      workspaceId: "ws_m11",
      name: "M11 Controlled Autonomy Workspace",
      ownerUserId: ownerUser.userId,
    });

    environmentManager.registerEnvironment({
      id: "env_ws_m11",
      name: "M11 Dev Environment",
      type: "DEVELOPMENT",
      capabilities: ["code_build", "web_search", "git_operate", "inconc_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "ws_m11" },
    });

    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "ws_m11",
        allowedRoots: [process.cwd()],
        allowedTools: [
          "code_build",
          "web_search",
          "git_operate",
          "inconc_tool",
        ],
      }),
    );

    // Register test agent in AgentRegistry
    const testAgent: RegisteredAgent = {
      id: "agent_m11",
      name: "Strategy Chief Agent",
      capabilities: ["software-development", "web-research"],
      workspaceScopes: ["ws_m11"],
      toolScopes: ["code_build", "web_search", "git_operate", "inconc_tool"],
      provider: "local",
      model: "deterministic",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    };
    agentRegistry.registerAgent(testAgent);

    toolRegistry.register(new DummyTool("code_build", "Build Tool"));
    toolRegistry.register(new DummyTool("web_search", "Search Tool"));
    toolRegistry.register(new DummyTool("git_operate", "Git Tool"));

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      undefined,
      environmentManager,
      identityStore,
    );

    validPolicy = {
      maxIterations: 5,
      maxRuntimeMs: 30000,
      maxDelegations: 5,
      maxActions: 5,
      maxRetries: 2,
      allowedCapabilities: ["software-development", "web-research"],
      approvalMode: "AUTO_SAFE",
    };
  });

  describe("1. Identity & Workspace Authority", () => {
    it("starts run successfully for valid owner and active workspace member", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_id_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("AUTHORIZED");
      expect(run.ownerId).toBe(ownerUser.userId);
      expect(run.workspaceId).toBe("ws_m11");
    });

    it("fails closed (BLOCKED) for unknown owner", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_id_002",
        ownerId: "usr_unknown_stranger",
        workspaceId: "ws_m11",
        taskId: "task_002",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("BLOCKED");
      expect(run.terminalReason).toContain("does not exist or is disabled");
    });

    it("fails closed (BLOCKED) when owner is not an active workspace member", async () => {
      const otherUser = identityStore.createUser({
        primaryEmail: "other@example.com",
      });

      const config: BoundedAutonomyRunConfig = {
        runId: "run_id_003",
        ownerId: otherUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_003",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("BLOCKED");
      expect(run.terminalReason).toContain("not an active member of workspace");
    });

    it("fails closed (BLOCKED) when owner is deactivated mid-run", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_id_004",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_004",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("AUTHORIZED");

      // Deactivate owner membership in identityStore
      identityStore.addWorkspaceMembership({
        workspaceId: "ws_m11",
        userId: ownerUser.userId,
        role: "MEMBER",
        status: "INACTIVE",
      });

      policyEngine.setRule("code_build", "SAFE");
      const proposal: AIProposal = {
        runId: "run_id_004",
        taskId: "task_004",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      const updatedRun = await autonomyEngine.executeIteration(
        run.runId,
        proposal,
      );
      expect(updatedRun.status).toBe("BLOCKED");
      expect(updatedRun.terminalReason).toContain(
        "no longer an active workspace member",
      );
    });
  });

  describe("2. Explicit Autonomy Policy & Hard Limits", () => {
    it("fails closed on missing or invalid policy config", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_pol_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_pol_001",
        environmentId: "env_ws_m11",
        policy: { ...validPolicy, maxIterations: 0 },
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("BLOCKED");
      expect(run.terminalReason).toContain(
        "maxIterations must be a positive integer",
      );
    });

    it("terminates run with LIMIT_REACHED when iteration limit is exceeded", async () => {
      const shortPolicy: AutonomyPolicy = {
        ...validPolicy,
        maxIterations: 2,
      };

      const config: BoundedAutonomyRunConfig = {
        runId: "run_lim_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_lim_001",
        environmentId: "env_ws_m11",
        policy: shortPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      policyEngine.setRule("code_build", "SAFE");
      const proposal: AIProposal = {
        runId: "run_lim_001",
        taskId: "task_lim_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      const iter1 = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter1.status).toBe("RUNNING");

      const iter2 = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter2.status).toBe("COMPLETED");

      // Resetting status to test 3rd iteration exceeding maxIterations limit
      (iter2 as any).status = "RUNNING";
      const iter3 = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter3.status).toBe("LIMIT_REACHED");
      expect(iter3.terminalReason).toContain("Max iterations limit reached");
    });

    it("terminates run with TIMED_OUT when maxRuntimeMs is exceeded", async () => {
      const fastTimeoutPolicy: AutonomyPolicy = {
        ...validPolicy,
        maxRuntimeMs: 1,
      };

      const config: BoundedAutonomyRunConfig = {
        runId: "run_time_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_time_001",
        environmentId: "env_ws_m11",
        policy: fastTimeoutPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      await new Promise((res) => setTimeout(res, 10));

      policyEngine.setRule("code_build", "SAFE");
      const proposal: AIProposal = {
        runId: "run_time_001",
        taskId: "task_time_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      const iter = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter.status).toBe("TIMED_OUT");
      expect(iter.terminalReason).toContain("Max runtime exceeded");
    });
  });

  describe("3. Untrusted AI Proposal Contract & Validation", () => {
    it("rejects proposal targeting unallowed capability", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_prop_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_prop_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const unallowedProposal: AIProposal = {
        runId: "run_prop_001",
        taskId: "task_prop_001",
        workspaceId: "ws_m11",
        requestedCapability: "unauthorized-system-cap",
        proposedAction: "code_build",
        params: {},
      };

      const iter = await autonomyEngine.executeIteration(
        run.runId,
        unallowedProposal,
      );
      expect(iter.status).toBe("BLOCKED");
      expect(iter.terminalReason).toContain(
        "is not in allowedCapabilities list",
      );
    });

    it("rejects proposal containing security boundary modification or privileged triggers", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_prop_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_prop_002",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const maliciousProposal: AIProposal = {
        runId: "run_prop_002",
        taskId: "task_prop_002",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "modify_policyengine_rules",
        params: { cmd: "SUDO GRANT_PERMISSION" },
      };

      const iter = await autonomyEngine.executeIteration(
        run.runId,
        maliciousProposal,
      );
      expect(iter.status).toBe("BLOCKED");
      expect(iter.terminalReason).toContain(
        "Attempt to modify security boundary",
      );
    });

    it("rejects proposal with mismatched runId or taskId or workspaceId", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_prop_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_prop_003",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const wrongRunProposal: AIProposal = {
        runId: "SPOOFED_RUN_ID",
        taskId: "task_prop_003",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      const iter = await autonomyEngine.executeIteration(
        run.runId,
        wrongRunProposal,
      );
      expect(iter.status).toBe("BLOCKED");
      expect(iter.terminalReason).toContain("does not match active runId");
    });
  });

  describe("4. Action Authorization & Exact Approval Binding", () => {
    it("pauses execution in WAITING_FOR_APPROVAL when PolicyEngine requires approval", async () => {
      policyEngine.setRule("git_operate:push", "APPROVAL_REQUIRED");

      const config: BoundedAutonomyRunConfig = {
        runId: "run_app_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_app_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const proposal: AIProposal = {
        runId: "run_app_001",
        taskId: "task_app_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "git_operate",
        params: { action: "push" },
      };

      const iter = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter.status).toBe("WAITING_FOR_APPROVAL");
    });

    it("continues execution after explicit owner approval using single-use token", async () => {
      policyEngine.setRule("git_operate:push", "APPROVAL_REQUIRED");

      const config: BoundedAutonomyRunConfig = {
        runId: "run_app_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_app_002",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const proposal: AIProposal = {
        runId: "run_app_002",
        taskId: "task_app_002",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "git_operate",
        params: { action: "push" },
        isTerminalProposal: true,
      };

      const pausedRun = await autonomyEngine.executeIteration(
        run.runId,
        proposal,
      );
      expect(pausedRun.status).toBe("WAITING_FOR_APPROVAL");

      const fp = approvalManager.createFingerprint(
        "git_operate",
        { action: "push" },
        "ws_m11",
        "env_ws_m11",
        "git_operate:push",
      );

      approvalManager.grantApproval(fp, ownerUser.userId);

      const resumedRun = await autonomyEngine.approveAndContinueIteration(
        run.runId,
        ownerUser.userId,
        "ws_m11",
      );

      expect(resumedRun.status).toBe("COMPLETED");
    });

    it("rejects cross-workspace approval attempt", async () => {
      policyEngine.setRule("git_operate:push", "APPROVAL_REQUIRED");

      const config: BoundedAutonomyRunConfig = {
        runId: "run_app_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_app_003",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const proposal: AIProposal = {
        runId: "run_app_003",
        taskId: "task_app_003",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "git_operate",
        params: { action: "push" },
      };

      await autonomyEngine.executeIteration(run.runId, proposal);

      const crossWsRun = await autonomyEngine.approveAndContinueIteration(
        run.runId,
        ownerUser.userId,
        "ws_other_victim",
      );

      expect(crossWsRun.status).toBe("BLOCKED");
      expect(crossWsRun.terminalReason).toContain(
        "Cross-workspace approval attempt rejected",
      );
    });
  });

  describe("5. Terminal Immutability & Cancellation", () => {
    it("cancels run and prevents late AI responses from reviving terminal state", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_canc_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_canc_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);
      expect(run.status).toBe("AUTHORIZED");

      const cancelledRun = await autonomyEngine.cancelRun(
        run.runId,
        "Owner requested cancellation",
      );
      expect(cancelledRun.status).toBe("CANCELLED");
      expect(TERMINAL_AUTONOMY_STATES.has(cancelledRun.status)).toBe(true);

      policyEngine.setRule("code_build", "SAFE");
      const lateProposal: AIProposal = {
        runId: "run_canc_001",
        taskId: "task_canc_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      const postCancelRun = await autonomyEngine.executeIteration(
        run.runId,
        lateProposal,
      );
      expect(postCancelRun.status).toBe("CANCELLED");
    });
  });

  describe("6. Local Verification Boundary", () => {
    it("fails closed on INCONCLUSIVE execution result", async () => {
      const inconcTool = new DummyTool(
        "inconc_tool",
        "Inconclusive Tool",
        async () => null,
      );
      toolRegistry.register(inconcTool);

      policyEngine.setRule("inconc_tool", "SAFE");

      const config: BoundedAutonomyRunConfig = {
        runId: "run_ver_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_ver_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      const proposal: AIProposal = {
        runId: "run_ver_001",
        taskId: "task_ver_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "inconc_tool",
        params: {},
      };

      const iter = await autonomyEngine.executeIteration(run.runId, proposal);
      expect(iter.status).toBe("FAILED");
      expect(iter.lastVerificationResult).toBe("INCONCLUSIVE");
      expect(iter.terminalReason).toContain("INCONCLUSIVE");
    });
  });

  describe("7. Concurrency & Singleton Execution", () => {
    it("prevents duplicate active execution for same taskId", async () => {
      const config1: BoundedAutonomyRunConfig = {
        runId: "run_conc_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_conc_shared",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run1 = await autonomyEngine.startRun(config1);
      expect(run1.status).toBe("AUTHORIZED");

      const config2: BoundedAutonomyRunConfig = {
        runId: "run_conc_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_conc_shared",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run2 = await autonomyEngine.startRun(config2);
      expect(run2.status).toBe("BLOCKED");
      expect(run2.terminalReason).toContain(
        "Duplicate active execution rejected",
      );
    });
  });

  describe("8. Audit Trail Verification", () => {
    it("records audit events for autonomy lifecycle state transitions", async () => {
      const config: BoundedAutonomyRunConfig = {
        runId: "run_aud_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m11",
        taskId: "task_aud_001",
        environmentId: "env_ws_m11",
        policy: validPolicy,
      };

      const run = await autonomyEngine.startRun(config);

      policyEngine.setRule("code_build", "SAFE");
      const proposal: AIProposal = {
        runId: "run_aud_001",
        taskId: "task_aud_001",
        workspaceId: "ws_m11",
        requestedCapability: "software-development",
        proposedAction: "code_build",
        params: {},
      };

      await autonomyEngine.executeIteration(run.runId, proposal);

      const events = await auditManager.queryEvents({ workspaceId: "ws_m11" });
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.map((e) => e.type)).toContain("TASK_CREATED");
      expect(events.map((e) => e.type)).toContain("ACTION_COMPLETED");
    });
  });
});
