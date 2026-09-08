export interface AcceptanceCriteria {
  requiredRoutes: string[];
  maxBuildTimeMs?: number;
}

export interface AcceptanceResult {
  passed: boolean;
  reasons: string[];
}

export class AcceptanceEngine {
  evaluate(
    criteria: AcceptanceCriteria,
    executionOutput: unknown,
  ): AcceptanceResult {
    let actualRoutes: string[] = [];

    if (Array.isArray(executionOutput)) {
      actualRoutes = executionOutput as string[];
    } else if (executionOutput && typeof executionOutput === "object") {
      const obj = executionOutput as Record<string, unknown>;
      if (Array.isArray(obj.routes)) {
        actualRoutes = obj.routes as string[];
      } else if (Array.isArray(obj.actualRoutes)) {
        actualRoutes = obj.actualRoutes as string[];
      } else if (
        obj.toolResult &&
        typeof obj.toolResult === "object" &&
        Array.isArray((obj.toolResult as Record<string, unknown>).routes)
      ) {
        actualRoutes = (obj.toolResult as Record<string, unknown>)
          .routes as string[];
      }
    }

    const missing = criteria.requiredRoutes.filter(
      (r) => !actualRoutes.includes(r),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        reasons: [
          `Missing required acceptance routes in actual tool execution output: ${missing.join(", ")}`,
        ],
      };
    }
    return { passed: true, reasons: [] };
  }
}
