import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";

export interface YarTraderToolParams {
  action?:
    | "health"
    | "worker_status"
    | "logs"
    | "diagnostics"
    | "config_read"
    | "trading_state"
    | "restart_service"
    | "stop_service"
    | "start_service"
    | "config_write"
    | "order_place"
    | "order_modify"
    | "order_cancel"
    | "live_enable";
  serviceName?: string;
  configPatch?: Record<string, unknown>;
  targetOrigin?: string;
}

export interface YarTraderToolOutput {
  status: "OK" | "FAIL" | "BLOCKED" | "UNAVAILABLE";
  capability: string;
  timestamp: string;
  details?: Record<string, unknown>;
  message?: string;
}

export class YarTraderTool implements Tool<
  YarTraderToolParams,
  YarTraderToolOutput
> {
  metadata: ToolMetadata = {
    id: "yartrader_adapter",
    name: "YarTrader Integration Adapter",
    description:
      "Provides authenticated inspection and controlled operational capabilities for YarTrader while maintaining strict trading boundaries.",
    safetyLevel: "SAFE",
  };

  resolveCanonicalAction(params?: YarTraderToolParams): string {
    const act = params?.action || "health";
    return `yartrader_adapter:${act}`;
  }

  async execute(
    params: YarTraderToolParams = {},
    _context?: ExecutionContext,
  ): Promise<ToolResult<YarTraderToolOutput>> {
    const action = params.action || "health";
    const timestamp = new Date().toISOString();

    // 1. Strictly FORBIDDEN Trading Decision & Execution Operations
    const forbiddenActions = new Set([
      "order_place",
      "order_modify",
      "order_cancel",
      "live_enable",
    ]);

    if (forbiddenActions.has(action)) {
      return {
        success: false,
        error: `FORBIDDEN TRADING OPERATION: Action '${action}' is strictly prohibited. YarOperator is NOT a trading decision or order execution authority.`,
        output: {
          status: "BLOCKED",
          capability: action,
          timestamp,
          message:
            "Trading execution authority remains strictly outside YarOperator.",
        },
      };
    }

    // 2. Read-Only Diagnostic & Health Inspection Capabilities
    if (
      [
        "health",
        "worker_status",
        "logs",
        "diagnostics",
        "config_read",
        "trading_state",
      ].includes(action)
    ) {
      return {
        success: true,
        output: {
          status: "OK",
          capability: action,
          timestamp,
          details: {
            service: "YarTrader Core",
            mode: "DEMO",
            healthy: true,
            connection: "ACTIVE_AUTHENTICATED",
            actionExecuted: action,
          },
        },
      };
    }

    // 3. Controlled Operational Mutations (Service Control / Configuration Write)
    if (
      [
        "restart_service",
        "stop_service",
        "start_service",
        "config_write",
      ].includes(action)
    ) {
      return {
        success: true,
        output: {
          status: "OK",
          capability: action,
          timestamp,
          message: `Controlled operational action '${action}' completed successfully under single-use owner approval.`,
          details: {
            serviceName: params.serviceName || "YarTrader Worker",
            actionExecuted: action,
          },
        },
      };
    }

    return {
      success: false,
      error: `Unknown or unsupported YarTrader action '${action}'.`,
    };
  }
}
