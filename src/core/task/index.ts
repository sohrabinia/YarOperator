import { WorkflowDefinition, WorkflowValidator } from "../workflow/index.js";
import {
  AcceptanceEngine,
  AcceptanceCriteria,
  AcceptanceResult,
} from "../acceptance/index.js";
import {
  AgentOrchestrator,
  OrchestrationResult,
} from "../orchestrator/index.js";
import { ExecutionContext, BrainResult } from "../contracts/index.js";

export type TaskStepStatus =
  | "PENDING"
  | "EXECUTING"
  | "COMPLETED"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "FAILED";

export interface TaskStep {
  id: string;
  capability?: string;
  requestedToolId?: string;
  brainResult?: BrainResult;
  params:
    | Record<string, unknown>
    | ((prevOutputs: Record<string, unknown>) => Record<string, unknown>);
  dependsOn?: string[];
  verificationCriteria?: AcceptanceCriteria;
}

export interface TaskDefinition {
  id: string;
  name: string;
  workspaceId: string;
  environmentId?: string;
  steps: TaskStep[];
  brainResult?: BrainResult;
}

export interface TaskStepExecutionResult {
  stepId: string;
  capability?: string;
  toolId?: string;
  status: TaskStepStatus;
  output?: unknown;
  error?: string;
  verification?: AcceptanceResult;
}

export interface TaskExecutionResult {
  taskId: string;
  workspaceId: string;
  success: boolean;
  status:
    | "COMPLETED"
    | "PARTIAL_FAILURE"
    | "BLOCKED"
    | "APPROVAL_REQUIRED"
    | "FAILED";
  executedSteps: TaskStepExecutionResult[];
  finalOutput?: Record<string, unknown>;
  error?: string;
}

export class TaskExecutor {
  private acceptanceEngine = new AcceptanceEngine();

  constructor(private orchestrator: AgentOrchestrator) {}

  public async executeTask(
    task: TaskDefinition,
    context?: ExecutionContext,
  ): Promise<TaskExecutionResult> {
    // 1. Convert TaskDefinition steps to WorkflowDefinition to reuse WorkflowValidator DAG cycle & dependency validation
    const workflowDef: WorkflowDefinition = {
      id: task.id,
      name: task.name,
      steps: task.steps.map((s) => ({
        id: s.id,
        toolId: s.requestedToolId || s.capability || "default",
        params: s.params,
        dependsOn: s.dependsOn,
      })),
    };

    const validation = WorkflowValidator.validate(workflowDef);
    if (!validation.valid) {
      return {
        taskId: task.id,
        workspaceId: task.workspaceId,
        success: false,
        status: "FAILED",
        executedSteps: [],
        error: `Task validation failed: ${validation.error}`,
      };
    }

    const executedStepResults: TaskStepExecutionResult[] = [];
    const stepOutputs: Record<string, unknown> = {};
    const completedStepIds = new Set<string>();
    const remainingSteps = [...task.steps];

    while (remainingSteps.length > 0) {
      // Find step whose dependencies are satisfied
      const readyIndex = remainingSteps.findIndex((step) => {
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        return step.dependsOn.every((depId) => completedStepIds.has(depId));
      });

      if (readyIndex === -1) {
        return {
          taskId: task.id,
          workspaceId: task.workspaceId,
          success: false,
          status: "FAILED",
          executedSteps: executedStepResults,
          error: "Unresolvable dependency resolution in task execution.",
        };
      }

      const [currentStep] = remainingSteps.splice(readyIndex, 1);

      // Resolve step parameters dynamically if function
      const resolvedParams =
        typeof currentStep.params === "function"
          ? currentStep.params(stepOutputs)
          : currentStep.params;

      // Execute step via AgentOrchestrator to enforce Capability Resolution & PolicyEngine evaluation
      const orchResult: OrchestrationResult =
        await this.orchestrator.orchestrateBrainResult(
          {
            brainResult: currentStep.brainResult ||
              task.brainResult || {
                intent: "ACTION",
                actionGoal: "DEVELOPMENT",
              },
            commandId: `${task.id}_${currentStep.id}`,
            workspaceId: task.workspaceId,
            environmentId: task.environmentId,
            targetCapability: currentStep.capability,
            requestedToolId: currentStep.requestedToolId,
            params: resolvedParams,
          },
          context,
        );

      // Map OrchestrationResult status to TaskStepStatus
      if (!orchResult.accepted || orchResult.status !== "COMPLETED") {
        const stepStatus: TaskStepStatus =
          orchResult.status === "APPROVAL_REQUIRED"
            ? "APPROVAL_REQUIRED"
            : orchResult.status === "BLOCKED"
              ? "BLOCKED"
              : "FAILED";

        const failedStepRes: TaskStepExecutionResult = {
          stepId: currentStep.id,
          capability: orchResult.resolvedCapability || currentStep.capability,
          toolId: orchResult.resolvedToolId || currentStep.requestedToolId,
          status: stepStatus,
          error:
            orchResult.error || orchResult.reason || "Step execution failed.",
        };

        executedStepResults.push(failedStepRes);

        const taskStatus =
          stepStatus === "APPROVAL_REQUIRED"
            ? "APPROVAL_REQUIRED"
            : stepStatus === "BLOCKED"
              ? "BLOCKED"
              : executedStepResults.length > 1
                ? "PARTIAL_FAILURE"
                : "FAILED";

        return {
          taskId: task.id,
          workspaceId: task.workspaceId,
          success: false,
          status: taskStatus,
          executedSteps: executedStepResults,
          error: failedStepRes.error,
        };
      }

      // Step execution succeeded in SecureToolEcosystem / RealWorldAssistant
      // Perform Verification using AcceptanceEngine if criteria specified
      let verificationRes: AcceptanceResult | undefined;
      if (currentStep.verificationCriteria) {
        verificationRes = this.acceptanceEngine.evaluate(
          currentStep.verificationCriteria,
          orchResult.output,
        );

        if (!verificationRes.passed) {
          const verifyError = `Step '${currentStep.id}' verification failed: ${verificationRes.reasons.join(", ")}`;
          const failedStepRes: TaskStepExecutionResult = {
            stepId: currentStep.id,
            capability: orchResult.resolvedCapability || currentStep.capability,
            toolId: orchResult.resolvedToolId || currentStep.requestedToolId,
            status: "FAILED",
            output: orchResult.output,
            verification: verificationRes,
            error: verifyError,
          };

          executedStepResults.push(failedStepRes);

          return {
            taskId: task.id,
            workspaceId: task.workspaceId,
            success: false,
            status:
              executedStepResults.length > 1 ? "PARTIAL_FAILURE" : "FAILED",
            executedSteps: executedStepResults,
            error: verifyError,
          };
        }
      }

      // Step completed and verified successfully
      const stepRes: TaskStepExecutionResult = {
        stepId: currentStep.id,
        capability: orchResult.resolvedCapability || currentStep.capability,
        toolId: orchResult.resolvedToolId || currentStep.requestedToolId,
        status: "COMPLETED",
        output: orchResult.output,
        verification: verificationRes,
      };

      executedStepResults.push(stepRes);
      stepOutputs[currentStep.id] = orchResult.output;
      completedStepIds.add(currentStep.id);
    }

    return {
      taskId: task.id,
      workspaceId: task.workspaceId,
      success: true,
      status: "COMPLETED",
      executedSteps: executedStepResults,
      finalOutput: stepOutputs,
    };
  }
}
