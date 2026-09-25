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

  private resolveAllowedOrigins(): string[] {
    const origins: string[] = [];
    if (process.env.OPERATOR_YARTRADER_URL) {
      origins.push(process.env.OPERATOR_YARTRADER_URL);
    }
    if (this.overrideBaseUrl) {
      origins.push(this.overrideBaseUrl);
    }
    if (this.resourceResolver) {
      try {
        const registry = this.resourceResolver.getRegistry();
        const ws = registry.getWorkspace("yartrader");
        if (ws && ws.allowedHttpOrigins) {
          for (const o of ws.allowedHttpOrigins) {
            const origStr = typeof o === "string" ? o : o.origin;
            if (origStr && !origins.includes(origStr)) {
              origins.push(origStr);
            }
          }
        }
      } catch {}
    }
    return origins;
  }

  private resolveYarTraderBaseUrl(params?: YarTraderToolParams): {
    baseUrl: string | null;
    error?: string;
  } {
    const allowedOrigins = this.resolveAllowedOrigins();

    if (params?.targetOrigin) {
      const targetNorm = params.targetOrigin.replace(/\/$/, "").toLowerCase();
      const isAllowed = allowedOrigins.some((a) => {
        const allowedNorm = a.replace(/\/$/, "").toLowerCase();
        return (
          allowedNorm === targetNorm ||
          allowedNorm === "*" ||
          new URL(allowedNorm).host === new URL(targetNorm).host
        );
      });

      if (!isAllowed) {
        return {
          baseUrl: null,
          error: `DESTINATION DENIED: Target origin '${params.targetOrigin}' is not in the workspace allowedHttpOrigins allowlist.`,
        };
      }
      return { baseUrl: params.targetOrigin };
    }

    if (allowedOrigins.length > 0) {
      return { baseUrl: allowedOrigins[0] };
    }

    return {
      baseUrl: null,
      error: `YarTrader connection UNAVAILABLE: No endpoint URL configured via OPERATOR_YARTRADER_URL or ResourceRegistry allowlist.`,
    };
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

    // 2. Resolve & Validate YarTrader Destination Base URL against Authoritative Allowlist
    const urlResolution = this.resolveYarTraderBaseUrl(params);
    if (!urlResolution.baseUrl) {
      return {
        success: false,
        error: urlResolution.error || "YarTrader connection UNAVAILABLE.",
        output: {
          status: "UNAVAILABLE",
          capability: action,
          timestamp,
          message:
            "YarTrader endpoint is unconfigured or unreachable. No fabricated state is provided.",
        },
      };
    }

    const baseUrl = urlResolution.baseUrl;
    const allowedOrigins = this.resolveAllowedOrigins();
    const httpProbe = new BoundedHttpProbe(
      allowedOrigins.length > 0 ? allowedOrigins : [baseUrl],
      5000,
      2000,
    );

    // 3. Endpoint Route Resolution
    const isMutation = [
      "restart_service",
      "stop_service",
      "start_service",
      "config_write",
    ].includes(action);

    const endpointPath =
      action === "health"
        ? "/health"
        : action === "worker_status"
          ? "/status"
          : action === "logs"
            ? "/logs"
            : action === "diagnostics"
              ? "/diagnostics"
              : action === "config_read"
                ? "/config"
                : action === "trading_state"
                  ? "/trading/state"
                  : action === "restart_service"
                    ? "/service/restart"
                    : action === "stop_service"
                      ? "/service/stop"
                      : action === "start_service"
                        ? "/service/start"
                        : action === "config_write"
                          ? "/config"
                          : `/${action}`;

    const targetUrl = `${baseUrl.replace(/\/$/, "")}${endpointPath}`;

    // 4. Issue Bounded Request (GET for reads, POST for mutations)
    const probeRes = isMutation
      ? await httpProbe.request(targetUrl, {
          method: "POST",
          body: JSON.stringify({
            action,
            serviceName: params.serviceName,
            configPatch: params.configPatch,
          }),
        })
      : await httpProbe.get(targetUrl);

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

    // 5. Parse and Return Real Unfabricated YarTrader Payload
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
