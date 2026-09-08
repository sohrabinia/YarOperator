import { ExecutionEngine } from "../engine/index.js";
import { AuditLogger } from "../audit/index.js";
import { ExecutionContext } from "../contracts/index.js";

export interface WorkflowStep {
  id: string;
  toolId: string;
  params:
    | Record<string, unknown>
    | ((prevOutputs: Record<string, unknown>) => Record<string, unknown>);
  dependsOn?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

export interface WorkflowExecutionResult {
  workflowId: string;
  success: boolean;
  stepResults: Record<string, unknown>;
  error?: string;
}

export class WorkflowValidator {
  static validate(workflow: WorkflowDefinition): {
    valid: boolean;
    error?: string;
  } {
    if (!workflow.id || !workflow.name) {
      return { valid: false, error: "Workflow requires id and name." };
    }

    if (!workflow.steps || workflow.steps.length === 0) {
      return {
        valid: false,
        error: "Workflow must contain at least one step.",
      };
    }

    const stepIds = new Set<string>();
    for (const step of workflow.steps) {
      if (stepIds.has(step.id)) {
        return {
          valid: false,
          error: `Duplicate step ID '${step.id}' detected in workflow.`,
        };
      }
      stepIds.add(step.id);
    }

    for (const step of workflow.steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepIds.has(depId)) {
            return {
              valid: false,
              error: `Step '${step.id}' depends on missing step '${depId}'.`,
            };
          }
          if (depId === step.id) {
            return {
              valid: false,
              error: `Step '${step.id}' cannot depend on itself.`,
            };
          }
        }
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (currId: string): boolean => {
      visited.add(currId);
      recStack.add(currId);

      const step = workflow.steps.find((s) => s.id === currId);
      if (step && step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!visited.has(depId)) {
            if (hasCycle(depId)) return true;
          } else if (recStack.has(depId)) {
            return true;
          }
        }
      }

      recStack.delete(currId);
      return false;
    };

    for (const step of workflow.steps) {
      if (!visited.has(step.id)) {
        if (hasCycle(step.id)) {
          return {
            valid: false,
            error: "Cyclic dependency detected in workflow DAG.",
          };
        }
      }
    }

    return { valid: true };
  }
}

export class WorkflowEngine {
  constructor(
    private executionEngine: ExecutionEngine,
    private auditLogger: AuditLogger,
  ) {}

  async executeWorkflow(
    workflow: WorkflowDefinition,
    context: ExecutionContext,
  ): Promise<WorkflowExecutionResult> {
    const validation = WorkflowValidator.validate(workflow);
    if (!validation.valid) {
      return {
        workflowId: workflow.id,
        success: false,
        stepResults: {},
        error: `Workflow validation failed: ${validation.error}`,
      };
    }

    this.auditLogger.log({
      executionId: context.executionId,
      type: "STEP_START",
      details: { workflowId: workflow.id, name: workflow.name },
    });

    const stepResults: Record<string, unknown> = {};
    const executedSteps = new Set<string>();
    const remainingSteps = [...workflow.steps];

    while (remainingSteps.length > 0) {
      const readyIndex = remainingSteps.findIndex((step) => {
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        return step.dependsOn.every((depId) => executedSteps.has(depId));
      });

      if (readyIndex === -1) {
        return {
          workflowId: workflow.id,
          success: false,
          stepResults,
          error: "Unresolvable dependency resolution in workflow execution.",
        };
      }

      const [currentStep] = remainingSteps.splice(readyIndex, 1);

      const resolvedParams =
        typeof currentStep.params === "function"
          ? currentStep.params(stepResults)
          : currentStep.params;

      const res = await this.executionEngine.execute(
        currentStep.toolId,
        resolvedParams,
        context,
      );

      if (!res.success) {
        this.auditLogger.log({
          executionId: context.executionId,
          type: "ERROR",
          details: {
            workflowId: workflow.id,
            failedStepId: currentStep.id,
            error: res.error,
          },
        });

        return {
          workflowId: workflow.id,
          success: false,
          stepResults,
          error: `Step '${currentStep.id}' failed: ${res.error}`,
        };
      }

      stepResults[currentStep.id] = res.output;
      executedSteps.add(currentStep.id);
    }

    this.auditLogger.log({
      executionId: context.executionId,
      type: "STEP_END",
      details: { workflowId: workflow.id, success: true },
    });

    return {
      workflowId: workflow.id,
      success: true,
      stepResults,
    };
  }
}
