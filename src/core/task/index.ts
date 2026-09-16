import {
  BrainResult,
  BrainIntent,
  ExecutionContext,
} from "../contracts/index.js";
import { WorkflowValidator, WorkflowDefinition } from "../workflow/index.js";
import { AcceptanceEngine, AcceptanceCriteria } from "../acceptance/index.js";
import {
  AgentOrchestrator,
  OrchestrationRequest,
} from "../orchestrator/index.js";

export type TaskStatus =
  | "PLANNED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "VERIFICATION_FAILED"
  | "BLOCKED"
  | "APPROVAL_REQUIRED";

export interface TaskStep {
  id: string;
  brainResult: BrainResult;
  commandId: string;
  workspaceId: string;
  environmentId?: string;
  targetCapability?: string;
  requestedToolId?: string;
  params?: Record<string, unknown>;
  rawCommandText?: string;
  dependsOn?: string[];
}

export interface TaskPlan {
  id: string;
  name: string;
  steps: TaskStep[];
  acceptanceCriteria?: AcceptanceCriteria;
}

export interface TaskStepResult {
  stepId: string;
  success: boolean;
  status: TaskStatus;
  intent: BrainIntent;
  resolvedCapability?: string;
  resolvedToolId?: string;
  output?: unknown;
  error?: string;
  reason?: string;
  reply?: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  success: boolean;
  stepResults: Record<string, TaskStepResult>;
  verificationPassed?: boolean;
  verificationReasons?: string[];
  error?: string;
}

export class TaskExecutor {
  private acceptanceEngine: AcceptanceEngine;

  constructor(
    private orchestrator: AgentOrchestrator,
    acceptanceEngine?: AcceptanceEngine,
  ) {
    this.acceptanceEngine = acceptanceEngine || new AcceptanceEngine();
  }

  public plan(taskPlan: TaskPlan): { valid: boolean; error?: string } {
    if (!taskPlan.id || !taskPlan.name) {
      return { valid: false, error: "TaskPlan requires id and name." };
    }

    if (!taskPlan.steps || taskPlan.steps.length === 0) {
      return {
        valid: false,
        error: "TaskPlan must contain at least one step.",
      };
    }

    const workflowDef: WorkflowDefinition = {
      id: taskPlan.id,
      name: taskPlan.name,
      steps: taskPlan.steps.map((s) => ({
        id: s.id,
        toolId: s.requestedToolId || s.targetCapability || "task_tool",
        params: s.params || {},
        dependsOn: s.dependsOn,
      })),
    };

    const validation = WorkflowValidator.validate(workflowDef);
    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }

    return { valid: true };
  }

  public async execute(
    taskPlan: TaskPlan,
    context?: ExecutionContext,
  ): Promise<TaskResult> {
    const planCheck = this.plan(taskPlan);
    if (!planCheck.valid) {
      return {
        taskId: taskPlan.id,
        status: "FAILED",
        success: false,
        stepResults: {},
        error: `Plan validation failed: ${planCheck.error}`,
      };
    }

    const stepResults: Record<string, TaskStepResult> = {};
    const executedSteps = new Set<string>();
    const remainingSteps = [...taskPlan.steps];

    while (remainingSteps.length > 0) {
      const readyIndex = remainingSteps.findIndex((step) => {
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        return step.dependsOn.every((depId) => executedSteps.has(depId));
      });

      if (readyIndex === -1) {
        return {
          taskId: taskPlan.id,
          status: "FAILED",
          success: false,
          stepResults,
          error: "Unresolvable dependency resolution in task execution.",
        };
      }

      const [currentStep] = remainingSteps.splice(readyIndex, 1);

      const req: OrchestrationRequest = {
        brainResult: currentStep.brainResult,
        commandId: currentStep.commandId,
        workspaceId: currentStep.workspaceId,
        environmentId: currentStep.environmentId || "env_default",
        targetCapability: currentStep.targetCapability,
        requestedToolId: currentStep.requestedToolId,
        params: currentStep.params,
        rawCommandText: currentStep.rawCommandText,
      };

      const stepContext: ExecutionContext = context || {
        executionId: `exec_${currentStep.commandId}`,
        timestamp: new Date(),
        workspaceId: currentStep.workspaceId,
        environmentId: currentStep.environmentId || "env_default",
      };

      const orchRes = await this.orchestrator.orchestrateBrainResult(
        req,
        stepContext,
      );

      const stepStatus: TaskStatus =
        orchRes.status === "COMPLETED"
          ? "COMPLETED"
          : orchRes.status === "APPROVAL_REQUIRED"
            ? "APPROVAL_REQUIRED"
            : orchRes.status === "BLOCKED"
              ? "BLOCKED"
              : orchRes.status === "CONVERSATION"
                ? "COMPLETED"
                : orchRes.status === "AMBIGUOUS"
                  ? "BLOCKED"
                  : "FAILED";

      const stepResult: TaskStepResult = {
        stepId: currentStep.id,
        success: orchRes.accepted && orchRes.status === "COMPLETED",
        status: stepStatus,
        intent: orchRes.intent,
        resolvedCapability: orchRes.resolvedCapability,
        resolvedToolId: orchRes.resolvedToolId,
        output: orchRes.output,
        error: orchRes.error,
        reason: orchRes.reason,
        reply: orchRes.reply,
      };

      stepResults[currentStep.id] = stepResult;

      if (!orchRes.accepted || orchRes.status !== "COMPLETED") {
        if (orchRes.intent === "CONVERSATION") {
          return {
            taskId: taskPlan.id,
            status: "COMPLETED",
            success: true,
            stepResults,
          };
        }

        const taskOverallStatus: TaskStatus =
          orchRes.status === "APPROVAL_REQUIRED"
            ? "APPROVAL_REQUIRED"
            : orchRes.status === "BLOCKED" || orchRes.status === "AMBIGUOUS"
              ? "BLOCKED"
              : "FAILED";

        return {
          taskId: taskPlan.id,
          status: taskOverallStatus,
          success: false,
          stepResults,
          error:
            orchRes.error ||
            orchRes.reason ||
            `Step '${currentStep.id}' execution failed.`,
        };
      }

      executedSteps.add(currentStep.id);
    }

    if (taskPlan.acceptanceCriteria) {
      const allOutputs = Object.values(stepResults).map((s) => s.output);
      const verifyRes = this.acceptanceEngine.evaluate(
        taskPlan.acceptanceCriteria,
        allOutputs.length === 1 ? allOutputs[0] : allOutputs,
      );

      if (!verifyRes.passed) {
        return {
          taskId: taskPlan.id,
          status: "VERIFICATION_FAILED",
          success: false,
          stepResults,
          verificationPassed: false,
          verificationReasons: verifyRes.reasons,
          error: `Task verification failed: ${verifyRes.reasons.join("; ")}`,
        };
      }

      return {
        taskId: taskPlan.id,
        status: "COMPLETED",
        success: true,
        stepResults,
        verificationPassed: true,
        verificationReasons: [],
      };
    }

    return {
      taskId: taskPlan.id,
      status: "COMPLETED",
      success: true,
      stepResults,
    };
  }
}
