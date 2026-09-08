import {
  ExecutionContext,
  ExecutionState,
  ToolRequest,
  ToolResult,
} from "../contracts/index.js";
import { ToolRegistry } from "../registry/index.js";
import { AuditLogger } from "../audit/index.js";

export interface PolicyEvaluator {
  evaluate(
    request: ToolRequest,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export class ExecutionEngine {
  private state: ExecutionState = "IDLE";

  constructor(
    private registry: ToolRegistry,
    private auditLogger: AuditLogger,
    private policyEvaluator?: PolicyEvaluator,
  ) {}

  getState(): ExecutionState {
    return this.state;
  }

  async execute<TParams, TOutput>(
    toolId: string,
    params: TParams,
    context: ExecutionContext,
  ): Promise<ToolResult<TOutput>> {
    this.transitionState("RUNNING", context.executionId);

    this.auditLogger.log({
      executionId: context.executionId,
      type: "STEP_START",
      details: { toolId, params },
    });

    const tool = this.registry.get(toolId);
    if (!tool) {
      const errorMsg = `Tool '${toolId}' not found in ToolRegistry.`;
      this.auditLogger.log({
        executionId: context.executionId,
        type: "ERROR",
        details: { toolId, error: errorMsg },
      });
      this.transitionState("FAILED", context.executionId);
      return { success: false, error: errorMsg };
    }

    if (this.policyEvaluator) {
      const evaluation = await this.policyEvaluator.evaluate({
        toolId,
        params,
        context,
      });
      this.auditLogger.log({
        executionId: context.executionId,
        type: "POLICY_EVALUATION",
        details: { toolId, evaluation },
      });

      if (!evaluation.allowed) {
        const errorMsg =
          evaluation.reason || "Execution blocked by policy engine.";
        this.transitionState("FAILED", context.executionId);
        return { success: false, error: errorMsg };
      }
    }

    try {
      const result = (await tool.execute(
        params,
        context,
      )) as ToolResult<TOutput>;

      this.auditLogger.log({
        executionId: context.executionId,
        type: "STEP_END",
        details: { toolId, success: result.success, result },
      });

      if (result.success) {
        this.transitionState("COMPLETED", context.executionId);
      } else {
        this.transitionState("FAILED", context.executionId);
      }

      return result;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.auditLogger.log({
        executionId: context.executionId,
        type: "ERROR",
        details: { toolId, error: errorMessage },
      });
      this.transitionState("FAILED", context.executionId);
      return { success: false, error: errorMessage };
    }
  }

  private transitionState(
    nextState: ExecutionState,
    executionId: string,
  ): void {
    const previousState = this.state;
    this.state = nextState;
    this.auditLogger.log({
      executionId,
      type: "STATE_TRANSITION",
      details: { previousState, nextState },
    });
  }
}
