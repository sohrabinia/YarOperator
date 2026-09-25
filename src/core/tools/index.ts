import { ExecutionScope } from "../orchestrator/index.js";
import { Tool, ToolResult, ExecutionContext } from "../contracts/index.js";
import { ToolRegistry } from "../registry/index.js";
export {
  OperatorHealthTool,
  SystemHealthProvider,
  type SystemHealthReport,
} from "./health.js";
export {
  YarTraderTool,
  type YarTraderToolParams,
  type YarTraderToolOutput,
} from "./yartrader.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { EnvironmentManager } from "../environment/index.js";
import { WorkspacePolicyManager } from "../workspace/policy.js";
import { ResourceResolver } from "../registry/resolver.js";

export interface ToolCapabilityReportItem {
  id: string;
  name: string;
  registered: boolean;
  status: "AVAILABLE" | "UNAVAILABLE";
  policy: string;
}

export class CapabilityReporter {
  public static generateReport(
    registry: ToolRegistry,
    policyEngine?: PolicyEngine,
    yarTraderAvailable: boolean = false,
  ): {
    tools: ToolCapabilityReportItem[];
    formattedReport: string;
  } {
    const registeredTools = registry.list();
    const toolReports: ToolCapabilityReportItem[] = [];

    const lines: string[] = [
      "من YarOperator هستم. گزارش پویای ابزارها و قابلیت‌های سیستم:",
    ];

    for (const tool of registeredTools) {
      const id = tool.metadata.id;
      const rule: string =
        policyEngine?.getRule(id) || tool.metadata.safetyLevel || "SAFE";

      let status: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE";
      if (id === "yartrader_adapter" && !yarTraderAvailable) {
        status = "UNAVAILABLE";
      }

      let policyStr: string = rule;
      if (id === "yartrader_adapter") {
        policyStr =
          "SAFE (پایش) / APPROVAL_REQUIRED (تغییرات) / BLOCKED (معاملات زنده)";
      } else if (id === "github_operate") {
        policyStr =
          "SAFE (مشاهده) / APPROVAL_REQUIRED (ساخت PR) / BLOCKED (ادغام)";
      } else if (id === "git_operate") {
        policyStr = "SAFE (وضعیت) / APPROVAL_REQUIRED (کامیت/پوش)";
      } else if (id === "browser_operate") {
        policyStr = "SAFE (پیمایش) / APPROVAL_REQUIRED (فرم)";
      }

      toolReports.push({
        id,
        name: tool.metadata.name,
        registered: true,
        status,
        policy: policyStr,
      });

      lines.push(
        `- ${id}: ثبت شده | وضعیت: ${status} | سطح دسترسی: ${policyStr}`,
      );
    }

    return {
      tools: toolReports,
      formattedReport: lines.join("\n"),
    };
  }
}

export class SecureToolEcosystem {
  constructor(
    private registry: ToolRegistry = new ToolRegistry(),
    private policyEngine?: PolicyEngine,
    private approvalManager?: ApprovalManager,
    private environmentManager?: EnvironmentManager,
    private workspacePolicyManager?: WorkspacePolicyManager,
    private resourceResolver?: ResourceResolver,
  ) {}

  public setResourceResolver(resolver: ResourceResolver): void {
    this.resourceResolver = resolver;
    for (const tool of this.registry.list()) {
      if (typeof (tool as any).setResourceResolver === "function") {
        (tool as any).setResourceResolver(resolver);
      }
    }
  }

  public getResourceResolver(): ResourceResolver | undefined {
    return this.resourceResolver;
  }

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
    if (
      this.resourceResolver &&
      typeof (tool as any).setResourceResolver === "function"
    ) {
      (tool as any).setResourceResolver(this.resourceResolver);
    }
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

    // 1. Mandatory Security Dependency Boundary Checks
    if (!this.policyEngine) {
      return {
        success: false,
        error: "PolicyEngine is required for tool execution.",
      };
    }

    if (!this.environmentManager) {
      return {
        success: false,
        error: "EnvironmentManager is required for tool execution.",
      };
    }

    if (!this.workspacePolicyManager) {
      return {
        success: false,
        error: "WorkspacePolicyManager is required for tool execution.",
      };
    }

    // 2. Resolve Canonical Action
    let canonicalAction = (params as any)?.action
      ? `${toolId}:${(params as any).action}`
      : toolId;
    if (typeof tool.resolveCanonicalAction === "function") {
      canonicalAction = tool.resolveCanonicalAction(params);
    }

    // 3. Environment Manager Boundary Validation
    const envId = context.environmentId;
    const wsId = context.workspaceId || scope.workspaceId;

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

    // 4. Workspace Policy Tool Validation
    if (!wsId || typeof wsId !== "string" || wsId.trim().length === 0) {
      return {
        success: false,
        error:
          "Missing mandatory workspace context: workspaceId is required for tool execution.",
      };
    }

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

    // 5. Authoritative Policy & Approval Gate Evaluation
    const evalResult = await this.policyEngine.evaluate(
      { toolId, params, context },
      canonicalAction,
      tool.metadata?.safetyLevel,
    );

    if (evalResult.safetyLevel === "BLOCKED") {
      return {
        success: false,
        error:
          evalResult.reason ||
          `Action '${canonicalAction}' is explicitly BLOCKED by policy.`,
      };
    }

    if (evalResult.safetyLevel === "APPROVAL_REQUIRED") {
      if (!this.approvalManager) {
        return {
          success: false,
          error: `Approval check failed: Action '${canonicalAction}' requires owner approval before execution.`,
        };
      }

      const consumption = this.approvalManager.consumeApproval(
        toolId,
        params,
        wsId,
        envId,
        canonicalAction,
      );

      if (!consumption.valid) {
        return {
          success: false,
          error: `Approval check failed for action '${canonicalAction}': ${consumption.reason}`,
        };
      }
    } else if (!evalResult.allowed) {
      return {
        success: false,
        error:
          evalResult.reason ||
          `Action '${canonicalAction}' is unclassified or ambiguous and defaults to BLOCKED (fail-closed policy).`,
      };
    }

    const toolContext: ExecutionContext = {
      ...context,
      metadata: {
        ...context.metadata,
        approved: true,
      },
    };

    try {
      return (await tool.execute(params, toolContext)) as ToolResult<TOutput>;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
