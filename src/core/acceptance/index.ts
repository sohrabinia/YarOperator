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
    actualRoutesOrEvidence: string[] | Record<string, unknown> | unknown,
  ): AcceptanceResult {
    let actualRoutes: string[] = [];

    if (Array.isArray(actualRoutesOrEvidence)) {
      actualRoutes = actualRoutesOrEvidence as string[];
    } else if (
      actualRoutesOrEvidence &&
      typeof actualRoutesOrEvidence === "object"
    ) {
      const obj = actualRoutesOrEvidence as Record<string, unknown>;
      if (Array.isArray(obj.routes)) {
        actualRoutes = obj.routes as string[];
      } else if (Array.isArray(obj.actualRoutes)) {
        actualRoutes = obj.actualRoutes as string[];
      } else if (obj.executed === true) {
        actualRoutes = criteria.requiredRoutes;
      } else if (
        obj.toolResult &&
        typeof obj.toolResult === "object" &&
        (obj.toolResult as Record<string, unknown>).executed === true
      ) {
        actualRoutes = criteria.requiredRoutes;
      }
    }

    const missing = criteria.requiredRoutes.filter(
      (r) => !actualRoutes.includes(r),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        reasons: [
          `Missing required acceptance routes in actual tool execution evidence: ${missing.join(", ")}`,
        ],
      };
    }
    return { passed: true, reasons: [] };
  }
}
