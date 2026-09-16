import { PolicyEngine } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import {
  ControlledAutonomyEngine,
  AutonomousActionRequest,
  AutonomyBudget,
} from "../autonomy/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { ExecutionContext, ActionSafetyLevel } from "../contracts/index.js";

export interface AssistantGoal {
  id: string;
  workspaceId: string;
  environmentId?: string;
  description: string;
  targetCapability: string;
  requestedToolId: string;
  params: Record<string, unknown>;
  consequential?: boolean;
}

export interface AssistantWorkflowStep {
  stepId: string;
  toolId: string;
  params: Record<string, unknown>;
  policyDecision: ActionSafetyLevel | "UNCLASSIFIED";
  status: "PENDING" | "EXECUTED" | "BLOCKED" | "APPROVAL_REQUIRED" | "FAILED";
  result?: unknown;
  error?: string;
}

export interface AssistantWorkflowPlan {
  goalId: string;
  workspaceId: string;
  steps: AssistantWorkflowStep[];
  createdAt: string;
}

export interface AssistantWorkflowResult {
  goalId: string;
  workspaceId: string;
  success: boolean;
  executedSteps: AssistantWorkflowStep[];
  evidence?: Record<string, unknown>;
  error?: string;
}

export class RealWorldAssistant {
  constructor(
    private orchestrator: AgentOrchestrator,
    private policyEngine: PolicyEngine,
    private autonomyEngine: ControlledAutonomyEngine,
    private auditManager: AuditManager,
    private notificationManager: NotificationManager,
  ) {}

  private resolveActionKey(goal: AssistantGoal): string {
    const toolId = goal.requestedToolId;
    const act = (goal.params as any)?.action;
    if (toolId === "git_operate") {
      if (act === "status") return "git_operate:status";
      if (act === "diff") return "git_operate:diff";
      if (act === "branch") {
        return (goal.params as any)?.branch
          ? "git_operate:branch_create"
          : "git_operate:branch_list";
      }
      if (act === "checkout") return "git_operate:checkout";
      if (act === "commit") return "git_operate:commit";
      if (act === "push") return "git_operate:push";
    }
    if (toolId === "browser_operate") {
      if (act === "click") return "browser_operate:click";
      if (act === "fill") return "browser_operate:fill";
      return "browser_operate:navigate";
    }
    if (toolId === "github_operate") {
      if (act === "get_pr") return "github_operate:get_pr";
      if (act === "create_pr") return "github_operate:create_pr";
      if (act === "merge_pr") return "github_operate:merge_pr";
    }
    if (toolId === "terminal_execute") {
      return "terminal_execute:run";
    }
    if (toolId === "web_research") {
      return "web_research:search";
    }
    return act ? `${toolId}:${act}` : toolId;
  }

  public createWorkflowPlan(goal: AssistantGoal): AssistantWorkflowPlan {
    const actionKey = this.resolveActionKey(goal);
    const policyDecision =
      this.policyEngine.resolveSafetyLevel(goal.requestedToolId, actionKey) ||
      "UNCLASSIFIED";

    const step: AssistantWorkflowStep = {
      stepId: `step_${Date.now()}_1`,
      toolId: goal.requestedToolId,
      params: goal.params,
      policyDecision,
      status: "PENDING",
    };

    return {
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      steps: [step],
      createdAt: new Date().toISOString(),
    };
  }

  public async executeWorkflow(
    goal: AssistantGoal,
    context: ExecutionContext,
  ): Promise<AssistantWorkflowResult> {
    const plan = this.createWorkflowPlan(goal);
    const step = plan.steps[0];

    await this.auditManager.recordEvent(
      "ACTION_STARTED",
      { goal, plan },
      { workspaceId: goal.workspaceId, taskId: goal.id },
    );

    const request: AutonomousActionRequest = {
      taskId: goal.id,
      workspaceId: goal.workspaceId,
      environmentId: goal.environmentId,
      toolId: goal.requestedToolId,
      params: goal.params,
      capability: goal.targetCapability,
    };

    const budget: AutonomyBudget = {
      maxActions: 5,
      maxRetries: 1,
      maxReplans: 1,
      usedActions: 0,
      usedRetries: 0,
      usedReplans: 0,
    };

    const runResult = await this.autonomyEngine.runControlledAction(
      request,
      budget,
      context,
    );

    if (runResult.state === "BLOCKED") {
      step.status = "BLOCKED";
      step.error = runResult.error || "Action BLOCKED by security boundary.";

      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { goal, step, reason: step.error },
        { workspaceId: goal.workspaceId, taskId: goal.id, severity: "HIGH" },
      );

      return {
        goalId: goal.id,
        workspaceId: goal.workspaceId,
        success: false,
        executedSteps: [step],
        error: step.error,
      };
    }

    if (runResult.state === "APPROVAL_REQUIRED") {
      step.status = "APPROVAL_REQUIRED";
      step.error =
        runResult.error ||
        `Tool '${goal.requestedToolId}' requires explicit owner approval.`;

      this.notificationManager.notify({
        workspaceId: goal.workspaceId,
        taskId: goal.id,
        type: "APPROVAL_REQUIRED",
        priority: "HIGH",
        title: "Action Requires Owner Approval",
        message: `Assistant goal '${goal.description}' requires approval for tool '${goal.requestedToolId}'.`,
      });

      await this.auditManager.recordEvent(
        "DECISION_MADE",
        { goal, step, decision: "APPROVAL_REQUIRED" },
        { workspaceId: goal.workspaceId, taskId: goal.id, severity: "MEDIUM" },
      );

      return {
        goalId: goal.id,
        workspaceId: goal.workspaceId,
        success: false,
        executedSteps: [step],
        error: step.error,
      };
    }

    if (!runResult.success) {
      step.status = "FAILED";
      step.error = runResult.error || "Execution failed";

      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { goal, step, error: runResult.error },
        { workspaceId: goal.workspaceId, taskId: goal.id, severity: "HIGH" },
      );

      return {
        goalId: goal.id,
        workspaceId: goal.workspaceId,
        success: false,
        executedSteps: [step],
        error: runResult.error,
      };
    }

    step.status = "EXECUTED";
    step.result = runResult.evidence?.toolResult;

    const evidence = {
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      toolId: goal.requestedToolId,
      toolResult: runResult.evidence?.toolResult,
      executedAt: new Date().toISOString(),
    };

    await this.auditManager.recordEvent(
      "ACTION_COMPLETED",
      { goal, step, evidence },
      { workspaceId: goal.workspaceId, taskId: goal.id },
    );

    this.notificationManager.notify({
      workspaceId: goal.workspaceId,
      taskId: goal.id,
      type: "TASK_COMPLETED",
      priority: "LOW",
      title: "Assistant Goal Completed",
      message: `Successfully executed real-world goal '${goal.description}'.`,
    });

    return {
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      success: true,
      executedSteps: [step],
      evidence,
    };
  }
}
