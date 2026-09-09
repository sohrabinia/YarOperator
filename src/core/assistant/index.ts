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

  public createWorkflowPlan(goal: AssistantGoal): AssistantWorkflowPlan {
    const policyDecision =
      this.policyEngine.getRule(goal.requestedToolId) || "UNCLASSIFIED";

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

    const policyRule =
      this.policyEngine.getRule(goal.requestedToolId) || "BLOCKED";

    if (policyRule === "BLOCKED") {
      step.status = "BLOCKED";
      step.error = `Tool '${goal.requestedToolId}' is explicitly BLOCKED by PolicyEngine.`;

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

    if (policyRule === "APPROVAL_REQUIRED") {
      step.status = "APPROVAL_REQUIRED";
      step.error = `Tool '${goal.requestedToolId}' requires explicit owner approval.`;

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

    // SAFE policy rule
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
