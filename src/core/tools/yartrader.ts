import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { BoundedHttpProbe } from "../diagnostic/index.js";
import { ResourceResolver } from "../registry/resolver.js";

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

  private resourceResolver?: ResourceResolver;
  private overrideBaseUrl?: string;

  constructor(options?: {
    resourceResolver?: ResourceResolver;
    baseUrl?: string;
  }) {
    if (options?.resourceResolver) {
      this.resourceResolver = options.resourceResolver;
    }
    if (options?.baseUrl) {
      this.overrideBaseUrl = options.baseUrl;
    }
  }

  public setResourceResolver(resolver: ResourceResolver): void {
    this.resourceResolver = resolver;
  }

  public setBaseUrl(url: string): void {
    this.overrideBaseUrl = url;
  }

  resolveCanonicalAction(params?: YarTraderToolParams): string {
    const act = params?.action || "health";
    return `yartrader_adapter:${act}`;
  }

  private resolveYarTraderBaseUrl(params?: YarTraderToolParams): string | null {
    if (params?.targetOrigin) {
      return params.targetOrigin;
    }
    if (this.overrideBaseUrl) {
      return this.overrideBaseUrl;
    }
    if (process.env.OPERATOR_YARTRADER_URL) {
      return process.env.OPERATOR_YARTRADER_URL;
    }
    if (this.resourceResolver) {
      try {
        const registry = this.resourceResolver.getRegistry();
        const ws = registry.getWorkspace("yartrader");
        if (ws && ws.allowedHttpOrigins && ws.allowedHttpOrigins.length > 0) {
          const firstOrigin = ws.allowedHttpOrigins[0];
          return typeof firstOrigin === "string"
            ? firstOrigin
            : firstOrigin.origin;
        }
      } catch {
        // Fall-through if workspace or registry not configured
      }
    }
    return null;
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

    // 2. Resolve YarTrader Base URL
    const baseUrl = this.resolveYarTraderBaseUrl(params);
    if (!baseUrl) {
      return {
        success: false,
        error: `YarTrader connection UNAVAILABLE: No endpoint URL configured via OPERATOR_YARTRADER_URL or ResourceRegistry.`,
        output: {
          status: "UNAVAILABLE",
          capability: action,
          timestamp,
          message:
            "YarTrader endpoint is unconfigured or unreachable. No fabricated state is provided.",
        },
      };
    }

    // 3. Perform Bounded Request to Actual YarTrader Endpoint
    let allowedOrigins: string[] = [baseUrl];
    if (this.resourceResolver) {
      try {
        const ws = this.resourceResolver
          .getRegistry()
          .getWorkspace("yartrader");
        if (ws && ws.allowedHttpOrigins) {
          allowedOrigins = ws.allowedHttpOrigins.map((o) =>
            typeof o === "string" ? o : o.origin,
          );
        }
      } catch {}
    }

    const httpProbe = new BoundedHttpProbe(allowedOrigins, 5000, 2000);
    const endpointPath =
      action === "health"
        ? "/health"
        : action === "worker_status"
          ? "/status"
          : action === "logs"
            ? "/logs"
            : action === "diagnostics"
              ? "/diagnostics"
              : action === "config_read" || action === "config_write"
                ? "/config"
                : action === "trading_state"
                  ? "/trading/state"
                  : `/${action}`;

    const targetUrl = `${baseUrl.replace(/\/$/, "")}${endpointPath}`;
    const probeRes = await httpProbe.get(targetUrl);

    if (!probeRes.success || !probeRes.body) {
      return {
        success: false,
        error: `YarTrader connection UNAVAILABLE: ${probeRes.error || `HTTP ${probeRes.statusCode || "FAILED"}`}`,
        output: {
          status: "UNAVAILABLE",
          capability: action,
          timestamp,
          message: `Failed to connect to YarTrader endpoint '${targetUrl}'. No simulated state provided.`,
        },
      };
    }

    // 4. Return Real Unfabricated YarTrader Payload
    let parsedDetails: Record<string, unknown> = {};
    try {
      parsedDetails = JSON.parse(probeRes.body);
    } catch {
      parsedDetails = { rawResponseBody: probeRes.body };
    }

    return {
      success: true,
      output: {
        status: "OK",
        capability: action,
        timestamp,
        details: parsedDetails,
      },
    };
  }
}
