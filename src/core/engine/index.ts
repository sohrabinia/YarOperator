import {
  ExecutionContext,
  ExecutionState,
  ToolResult,
} from "../contracts/index.js";
import { ExecutionScope } from "../orchestrator/index.js";
import { ToolRegistry } from "../registry/index.js";
import { AuditLogger } from "../audit/index.js";
import { SecureToolEcosystem } from "../tools/index.js";

export class ExecutionEngine {
  private state: ExecutionState = "IDLE";

  constructor(
    private registry: ToolRegistry,
    private auditLogger: AuditLogger,
    private ecosystem?: SecureToolEcosystem,
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

    if (!this.ecosystem) {
      const errorMsg =
        "FAIL CLOSED: Authoritative SecureToolEcosystem is required for ExecutionEngine tool execution.";
      this.auditLogger.log({
        executionId: context.executionId,
        type: "ERROR",
        details: { toolId, error: errorMsg },
      });
      this.transitionState("FAILED", context.executionId);
      return { success: false, error: errorMsg };
    }

    const wsId = context.workspaceId || "yartrader";
    const envId = context.environmentId || `env_${wsId}`;

    const enrichedContext: ExecutionContext = {
      ...context,
      workspaceId: wsId,
      environmentId: envId,
    };

    const scope: ExecutionScope = {
      id: `scope_${context.executionId}`,
      workspaceId: wsId,
      agentId: "agent_execution_engine",
      allowedCapabilities: [toolId],
      allowedTools: [toolId],
      maxRetries: 1,
    };

    const result = await this.ecosystem.execute<TParams, TOutput>(
      toolId,
      params,
      scope,
      enrichedContext,
    );

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
