import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";

export interface OperatorHealthOutput {
  health: {
    status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
    uptimeMs: number;
    timestamp: string;
  };
  readiness: {
    status: "READY" | "NOT_READY";
    subsystems: {
      commandReceiver: boolean;
      identityStore: boolean;
    };
    timestamp: string;
  };
}

export class OperatorHealthTool implements Tool<
  Record<string, unknown>,
  OperatorHealthOutput
> {
  metadata: ToolMetadata = {
    id: "operator_health",
    name: "Operator Health & Readiness Inspection",
    description:
      "Inspects authoritative YarOperator runtime health and readiness status without side effects.",
    safetyLevel: "SAFE",
  };

  constructor(
    private identityStoreSupplier?: () =>
      { checkIntegrity: () => boolean } | null | undefined,
  ) {}

  resolveCanonicalAction(_params?: Record<string, unknown>): string {
    return "operator_health:check";
  }

  async execute(
    _params: Record<string, unknown> = {},
    _context?: ExecutionContext,
  ): Promise<ToolResult<OperatorHealthOutput>> {
    let identityStoreReady = true;

    if (this.identityStoreSupplier) {
      try {
        const store = this.identityStoreSupplier();
        if (store) {
          identityStoreReady = store.checkIntegrity();
        }
      } catch {
        identityStoreReady = false;
      }
    }

    const isReady = identityStoreReady;
    const nowIso = new Date().toISOString();

    return {
      success: true,
      output: {
        health: {
          status: "HEALTHY",
          uptimeMs: Math.floor(process.uptime() * 1000),
          timestamp: nowIso,
        },
        readiness: {
          status: isReady ? "READY" : "NOT_READY",
          subsystems: {
            commandReceiver: true,
            identityStore: identityStoreReady,
          },
          timestamp: nowIso,
        },
      },
    };
  }
}
