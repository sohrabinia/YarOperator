import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";

export interface SystemHealthReport {
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
      resourceRegistry?: boolean;
    };
    timestamp: string;
  };
}

export class SystemHealthProvider {
  constructor(
    private commandReceiverSupplier?: () => boolean,
    private identityStoreSupplier?: () =>
      { checkIntegrity: () => boolean } | null | undefined,
    private healthEvaluator?: () => "HEALTHY" | "DEGRADED" | "UNHEALTHY",
    private resourceRegistrySupplier?: () => boolean,
  ) {}

  public setResourceRegistrySupplier(supplier: () => boolean): void {
    this.resourceRegistrySupplier = supplier;
  }

  public getReport(): SystemHealthReport {
    const nowIso = new Date().toISOString();
    const uptimeMs = Math.floor(process.uptime() * 1000);

    let commandReceiverReady = true;
    if (this.commandReceiverSupplier) {
      try {
        commandReceiverReady = this.commandReceiverSupplier();
      } catch {
        commandReceiverReady = false;
      }
    }

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

    let resourceRegistryReady = true;
    if (this.resourceRegistrySupplier) {
      try {
        resourceRegistryReady = this.resourceRegistrySupplier();
      } catch {
        resourceRegistryReady = false;
      }
    }

    const isReady =
      commandReceiverReady && identityStoreReady && resourceRegistryReady;
    const healthStatus = this.healthEvaluator
      ? this.healthEvaluator()
      : isReady
        ? "HEALTHY"
        : "DEGRADED";

    return {
      health: {
        status: healthStatus,
        uptimeMs,
        timestamp: nowIso,
      },
      readiness: {
        status: isReady ? "READY" : "NOT_READY",
        subsystems: {
          commandReceiver: commandReceiverReady,
          identityStore: identityStoreReady,
          resourceRegistry: resourceRegistryReady,
        },
        timestamp: nowIso,
      },
    };
  }
}

export class OperatorHealthTool implements Tool<
  Record<string, unknown>,
  SystemHealthReport
> {
  metadata: ToolMetadata = {
    id: "operator_health",
    name: "Operator Health & Readiness Inspection",
    description:
      "Inspects authoritative YarOperator runtime health and readiness status without side effects.",
    safetyLevel: "SAFE",
  };

  constructor(private healthProvider?: SystemHealthProvider) {}

  public setHealthProvider(healthProvider: SystemHealthProvider): void {
    this.healthProvider = healthProvider;
  }

  resolveCanonicalAction(_params?: Record<string, unknown>): string {
    return "operator_health:check";
  }

  async execute(
    _params: Record<string, unknown> = {},
    _context?: ExecutionContext,
  ): Promise<ToolResult<SystemHealthReport>> {
    const provider = this.healthProvider || new SystemHealthProvider();
    const report = provider.getReport();

    return {
      success: true,
      output: report,
    };
  }
}
