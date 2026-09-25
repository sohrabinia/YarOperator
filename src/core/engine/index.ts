import {
  ExecutionContext,
  ExecutionState,
  ToolRequest,
  ToolResult,
} from "../contracts/index.js";
import { ExecutionScope } from "../orchestrator/index.js";
import { ToolRegistry } from "../registry/index.js";
import { AuditLogger } from "../audit/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { PolicyEngine } from "../policy/index.js";
import { EnvironmentManager } from "../environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../workspace/policy.js";

export interface PolicyEvaluator {
  evaluate(
    request: ToolRequest,
    actionKey?: string,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export class ExecutionEngine {
  private state: ExecutionState = "IDLE";
  private ecosystem: SecureToolEcosystem;

  constructor(
    private registry: ToolRegistry,
    private auditLogger: AuditLogger,
    private policyEvaluator?: PolicyEvaluator,
    toolEcosystem?: SecureToolEcosystem,
  ) {
    if (toolEcosystem) {
      this.ecosystem = toolEcosystem;
    } else {
      const policyEngine =
        policyEvaluator instanceof PolicyEngine
          ? policyEvaluator
          : new PolicyEngine();

      if (policyEvaluator && !(policyEvaluator instanceof PolicyEngine)) {
        policyEngine.evaluate = async (request, actionKey) => {
          const evalRes = await policyEvaluator.evaluate(request, actionKey);
          return {
            allowed: evalRes.allowed,
            safetyLevel: evalRes.allowed ? "SAFE" : "BLOCKED",
            reason: evalRes.reason,
          };
        };
      }

      const envManager = new EnvironmentManager();
      const wsPolicyManager = new WorkspacePolicyManager();

      wsPolicyManager.registerPolicy(
        new WorkspacePolicy({
          workspaceId: "yartrader",
          allowedTools: ["*"],
          allowedRoots: [process.cwd()],
        }),
      );
      wsPolicyManager.registerPolicy(
        new WorkspacePolicy({
          workspaceId: "ws_default",
          allowedTools: ["*"],
          allowedRoots: [process.cwd()],
        }),
      );

      envManager.registerEnvironment({
        id: "env_yartrader",
        name: "Default Environment",
        type: "PRODUCTION",
        capabilities: [],
        accessScope: "workspace",
        riskLevel: "SAFE",
        healthy: true,
      });
      envManager.registerEnvironment({
        id: "env_ws_default",
        name: "Default Environment",
        type: "PRODUCTION",
        capabilities: [],
        accessScope: "workspace",
        riskLevel: "SAFE",
        healthy: true,
      });

      this.ecosystem = new SecureToolEcosystem(
        registry,
        policyEngine,
        (policyEngine as any).approvalManager,
        envManager,
        wsPolicyManager,
      );
    }
  }

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

    if (!this.policyEvaluator && this.ecosystem) {
      const pe = this.ecosystem.getPolicyEngine();
      if (pe && pe.resolveSafetyLevel(toolId) === undefined) {
        let canonicalAction = toolId;
        if (typeof tool.resolveCanonicalAction === "function") {
          canonicalAction = tool.resolveCanonicalAction(params);
        }
        pe.setRule(toolId, "SAFE");
        if (canonicalAction !== toolId) {
          pe.setRule(canonicalAction, "SAFE");
        }
      }
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
