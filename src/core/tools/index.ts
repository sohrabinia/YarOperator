import { ExecutionScope } from "../orchestrator/index.js";
import { Tool, ToolResult, ExecutionContext } from "../contracts/index.js";
import { ToolRegistry } from "../registry/index.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { EnvironmentManager } from "../environment/index.js";
import { WorkspacePolicyManager } from "../workspace/policy.js";

export class SecureToolEcosystem {
  constructor(
    private registry: ToolRegistry = new ToolRegistry(),
    private policyEngine?: PolicyEngine,
    private approvalManager?: ApprovalManager,
    private environmentManager?: EnvironmentManager,
    private workspacePolicyManager?: WorkspacePolicyManager,
  ) {}

  public setEnvironmentManager(envManager: EnvironmentManager): void {
    this.environmentManager = envManager;
  }

  public setWorkspacePolicyManager(
    wsPolicyManager: WorkspacePolicyManager,
  ): void {
    this.workspacePolicyManager = wsPolicyManager;
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getPolicyEngine(): PolicyEngine | undefined {
    return this.policyEngine;
  }

  getApprovalManager(): ApprovalManager | undefined {
    return this.approvalManager;
  }

  registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  isToolAuthorized(toolId: string, scope: ExecutionScope): boolean {
    return scope.allowedTools.includes(toolId);
  }

  async execute<TParams = unknown, TOutput = unknown>(
    toolId: string,
    params: TParams,
    scope: ExecutionScope,
    context: ExecutionContext,
  ): Promise<ToolResult<TOutput>> {
    if (!this.isToolAuthorized(toolId, scope)) {
      return {
        success: false,
        error: `Tool '${toolId}' is not authorized in current ExecutionScope.`,
      };
    }

    const tool = this.registry.get(toolId);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolId}' is not registered in ToolRegistry (unregistered tool is not executable).`,
      };
    }

    // 1. Environment Manager Boundary Validation before Tool.execute()
    const envId = context.environmentId;
    const wsId = context.workspaceId || scope.workspaceId;

    if (this.environmentManager) {
      if (!envId || typeof envId !== "string" || envId.trim().length === 0) {
        return {
          success: false,
          error:
            "Missing mandatory environment context: environmentId is required for tool execution.",
        };
      }

      const envCheck = this.environmentManager.validateEnvironmentAccess(
        envId,
        wsId,
        toolId,
      );

      if (!envCheck.valid) {
        return {
          success: false,
          error:
            envCheck.reason ||
            `Environment boundary check failed for environment '${envId}'.`,
        };
      }
    }

    // 2. Workspace Policy Tool Validation before Tool.execute()
    if (this.workspacePolicyManager && wsId) {
      const toolCheck = this.workspacePolicyManager.validateToolAccess(
        wsId,
        toolId,
      );
      if (!toolCheck.allowed) {
        return {
          success: false,
          error:
            toolCheck.reason ||
            `Tool '${toolId}' is blocked by WorkspacePolicy for workspace '${wsId}'.`,
        };
      }
    }

    try {
      return (await tool.execute(params, context)) as ToolResult<TOutput>;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
