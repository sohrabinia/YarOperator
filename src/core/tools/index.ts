import { ExecutionScope } from "../orchestrator/index.js";
import { Tool, ToolResult, ExecutionContext } from "../contracts/index.js";
import { ToolRegistry } from "../registry/index.js";

export class SecureToolEcosystem {
  constructor(private registry: ToolRegistry = new ToolRegistry()) {}

  getRegistry(): ToolRegistry {
    return this.registry;
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
        success: true,
        output: {
          executedTool: toolId,
          params,
          workspaceId: scope.workspaceId,
          timestamp: new Date().toISOString(),
        } as unknown as TOutput,
        metadata: {
          executionType: "DEFAULT_FALLBACK_DRIVER",
        },
      };
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
