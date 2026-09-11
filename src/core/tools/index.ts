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

  getWorkspacePolicyManager(): WorkspacePolicyManager | undefined {
    return this.workspacePolicyManager;
  }

  registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  isToolAuthorized(toolId: string, scope: ExecutionScope): boolean {
    return scope && Array.isArray(scope.allowedTools)
      ? scope.allowedTools.includes(toolId)
      : false;
  }

  async execute<TParams = unknown, TOutput = unknown>(
    toolId: string,
    params: TParams,
    scope: ExecutionScope,
    context: ExecutionContext,
  ): Promise<ToolResult<TOutput>> {
    // 1. Mandatory WorkspacePolicyManager Check (Fail Closed)
    if (!this.workspacePolicyManager) {
      return {
        success: false,
        error:
          "WorkspacePolicyManager missing: WorkspacePolicy is a mandatory security boundary and cannot be omitted.",
      };
    }

    // 2. Resolve workspaceId explicitly from context or scope (Fail Closed)
    const wsId = context?.workspaceId || scope?.workspaceId;

    if (!wsId || typeof wsId !== "string" || wsId.trim().length === 0) {
      return {
        success: false,
        error:
          "Missing workspaceId: Execution blocked because workspace identity could not be established.",
      };
    }

    // 3. Validate Workspace Policy Tool Access (Fail Closed)
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

    // 4. Validate Path / Root Access for Path-Sensitive Executions (Fail Closed)
    const targetPath =
      params && typeof params === "object"
        ? (params as Record<string, unknown>).cwd ||
          (params as Record<string, unknown>).path ||
          (params as Record<string, unknown>).targetPath
        : undefined;

    if (targetPath && typeof targetPath === "string") {
      const rootCheck = this.workspacePolicyManager.validateRootAccess(
        wsId,
        targetPath,
      );
      if (!rootCheck.allowed) {
        return {
          success: false,
          error:
            rootCheck.reason ||
            `Target path '${targetPath}' is blocked by WorkspacePolicy for workspace '${wsId}'.`,
        };
      }
    }

    // 5. Environment Manager Boundary Validation
    const envId = context?.environmentId;

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

    // 6. Execution Scope Authorization Check
    if (!this.isToolAuthorized(toolId, scope)) {
      return {
        success: false,
        error: `Tool '${toolId}' is not authorized in current ExecutionScope.`,
      };
    }

    // 7. Tool Registry Check
    const tool = this.registry.get(toolId);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolId}' is not registered in ToolRegistry (unregistered tool is not executable).`,
      };
    }

    // 8. Execute Tool
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
