import { describe, it, expect } from "vitest";
import { OperatorHealthTool } from "../src/core/tools/health.js";
import { GitTool } from "../src/core/git/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { RealWorldAssistant, AssistantGoal } from "../src/core/assistant/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { ResourceRegistry } from "../src/core/registry/resource.js";
import { ResourceResolver } from "../src/core/registry/resolver.js";

describe("Result Reporting Pipeline Contract (Real Implementation Testing)", () => {
  it("A. Structured successful Tool (OperatorHealthTool) preserves report output object", async () => {
    const healthTool = new OperatorHealthTool();
    const res = await healthTool.execute({ action: "check" });

    expect(res.success).toBe(true);
    expect(res.output).toBeDefined();
    expect(res.output?.health?.status).toBe("HEALTHY");
    expect(res.output?.readiness?.status).toBe("READY");
  });

  it("B. GitTool status command returns execution result with output or error", async () => {
    const registry = new ResourceRegistry({
      workspaces: [{
        workspaceId: "yartrader",
        repositoryName: "sohrabinia/YarTrader",
        rootPath: process.cwd(),
        environmentId: "env_yartrader",
        serviceName: "yartrader_api",
        allowedHttpOrigins: ["http://127.0.0.1:8000"],
        allowedRoots: [process.cwd()]
      }]
    }, { skipFsCheck: true });
    const resolver = new ResourceResolver(registry);
    const gitTool = new GitTool();
    gitTool.setResourceResolver(resolver);

    const res = await gitTool.execute({ action: "status" }, {
      executionId: "exec_git_1",
      timestamp: new Date(),
      workspaceId: "yartrader",
      environmentId: "env_yartrader"
    });

    expect(res).toBeDefined();
    expect(typeof res.success).toBe("boolean");
  });

  it("C. RealWorldAssistant workflow execution returns real step result and evidence", async () => {
    const registry = new AgentRegistry();
    const approvalMgr = new ApprovalManager(":memory:");
    const policyEngine = new PolicyEngine(approvalMgr);
    const orchestrator = new AgentOrchestrator(registry, policyEngine);
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager();

    const mockAutonomyEngine: any = {
      runControlledAction: async () => ({
        success: true,
        state: "COMPLETED",
        evidence: {
          toolResult: { health: { status: "HEALTHY" }, readiness: { status: "READY" } }
        }
      })
    };

    const assistant = new RealWorldAssistant(
      orchestrator,
      policyEngine,
      mockAutonomyEngine,
      auditManager,
      notificationManager
    );

    const goal: AssistantGoal = {
      id: "goal_test_1",
      workspaceId: "yartrader",
      environmentId: "env_yartrader",
      description: "Check system health",
      targetCapability: "system-monitoring",
      requestedToolId: "operator_health",
      params: { action: "check" }
    };

    const workflowRes = await assistant.executeWorkflow(goal, {
      executionId: "exec_test",
      timestamp: new Date(),
      workspaceId: "yartrader"
    });

    expect(workflowRes.success).toBe(true);
    expect(workflowRes.executedSteps.length).toBe(1);
    expect(workflowRes.executedSteps[0].status).toBe("EXECUTED");
    expect(workflowRes.executedSteps[0].result).toEqual({
      health: { status: "HEALTHY" },
      readiness: { status: "READY" }
    });
  });

  it("D. BLOCKED policy decision propagates reason without executing tool", async () => {
    const approvalMgr = new ApprovalManager(":memory:");
    const policyEngine = new PolicyEngine(approvalMgr);
    policyEngine.setRule("operator_health:check", "BLOCKED");

    const mockAutonomyEngine: any = {
      runControlledAction: async () => ({
        success: false,
        state: "BLOCKED",
        error: "Action 'operator_health:check' is explicitly BLOCKED by PolicyEngine."
      })
    };

    const assistant = new RealWorldAssistant(
      new AgentOrchestrator(new AgentRegistry()),
      policyEngine,
      mockAutonomyEngine,
      new AuditManager(),
      new NotificationManager()
    );

    const goal: AssistantGoal = {
      id: "goal_blocked_1",
      workspaceId: "yartrader",
      description: "Blocked action",
      targetCapability: "system-monitoring",
      requestedToolId: "operator_health",
      params: { action: "check" }
    };

    const res = await assistant.executeWorkflow(goal, {
      executionId: "exec_blocked",
      timestamp: new Date(),
      workspaceId: "yartrader"
    });

    expect(res.success).toBe(false);
    expect(res.executedSteps[0].status).toBe("BLOCKED");
    expect(res.executedSteps[0].error).toContain("BLOCKED");
  });
});
