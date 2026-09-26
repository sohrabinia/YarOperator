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

export type CapabilityState =
  "REGISTERED" | "AVAILABLE" | "APPROVAL_REQUIRED" | "BLOCKED" | "UNAVAILABLE";

export interface ToolCapabilityReportItem {
  id: string;
  name: string;
  state: CapabilityState;
  policy: string;
  actions?: Array<{
    action: string;
    state: CapabilityState;
    rule?: string;
  }>;
}

export class CapabilityReporter {
  public static generateReport(
    registry: ToolRegistry,
    policyEngine?: PolicyEngine,
    overrideAvailability?: Record<string, boolean>,
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
      const toolRules = policyEngine
        ? policyEngine.getRulesForTool(id)
        : new Map<string, string>();

      let isRuntimeAvailable = true;
      if (overrideAvailability && id in overrideAvailability) {
        isRuntimeAvailable = Boolean(overrideAvailability[id]);
      } else if (typeof (tool as any).isAvailable === "function") {
        try {
          isRuntimeAvailable = Boolean((tool as any).isAvailable());
        } catch {
          isRuntimeAvailable = false;
        }
      }

      const actionItems: Array<{
        action: string;
        state: CapabilityState;
        rule?: string;
      }> = [];

      let overallState: CapabilityState = isRuntimeAvailable
        ? "AVAILABLE"
        : "UNAVAILABLE";

      if (toolRules.size > 0) {
        const parts: string[] = [];
        let hasApprovalRequired = false;
        let hasBlocked = false;
        let hasSafe = false;

        for (const [actionKey, level] of toolRules.entries()) {
          const subAction = actionKey.includes(":")
            ? actionKey.split(":")[1]
            : actionKey;

          let actionState: CapabilityState = "REGISTERED";
          if (level === "BLOCKED") {
            actionState = "BLOCKED";
            hasBlocked = true;
          } else if (!isRuntimeAvailable) {
            actionState = "UNAVAILABLE";
          } else if (level === "APPROVAL_REQUIRED") {
            actionState = "APPROVAL_REQUIRED";
            hasApprovalRequired = true;
          } else if (level === "SAFE") {
            actionState = "AVAILABLE";
            hasSafe = true;
          }

          actionItems.push({
            action: subAction,
            state: actionState,
            rule: level,
          });

          parts.push(`${subAction}: ${actionState}`);
        }

        if (hasBlocked && !hasSafe && !hasApprovalRequired) {
          overallState = "BLOCKED";
        } else if (!isRuntimeAvailable) {
          overallState = "UNAVAILABLE";
        } else if (hasApprovalRequired && !hasSafe) {
          overallState = "APPROVAL_REQUIRED";
        } else if (hasSafe) {
          overallState = "AVAILABLE";
        } else {
          overallState = "REGISTERED";
        }

        const policyStr = parts.join(", ");
        toolReports.push({
          id,
          name: tool.metadata.name,
          state: overallState,
          policy: policyStr,
          actions: actionItems,
        });

        lines.push(
          `- ${id} (${tool.metadata.name}): وضعیت اصلی: ${overallState} | قوانین اکشن‌ها: ${policyStr}`,
        );
      } else if (policyEngine) {
        // Explicit PolicyEngine supplied but no action rules registered for this tool -> REGISTERED
        overallState = "REGISTERED";
        const policyStr = "NO_EXPLICIT_POLICY_RULE";

        toolReports.push({
          id,
          name: tool.metadata.name,
          state: overallState,
          policy: policyStr,
        });

        lines.push(
          `- ${id} (${tool.metadata.name}): وضعیت: REGISTERED | سطح دسترسی: بدون قانون صریح PolicyEngine`,
        );
      } else {
        // Backward compatibility fallback when NO PolicyEngine instance is supplied
        const fallbackLevel = tool.metadata.safetyLevel || "SAFE";
        if (fallbackLevel === "BLOCKED") {
          overallState = "BLOCKED";
        } else if (!isRuntimeAvailable) {
          overallState = "UNAVAILABLE";
        } else if (fallbackLevel === "APPROVAL_REQUIRED") {
          overallState = "APPROVAL_REQUIRED";
        } else {
          overallState = "AVAILABLE";
        }

        toolReports.push({
          id,
          name: tool.metadata.name,
          state: overallState,
          policy: fallbackLevel,
        });

        lines.push(
          `- ${id} (${tool.metadata.name}): وضعیت: ${overallState} | سطح دسترسی (توصیفی): ${fallbackLevel}`,
        );
      }
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
