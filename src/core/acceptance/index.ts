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
    actualRoutes: string[],
  ): AcceptanceResult {
    const missing = criteria.requiredRoutes.filter(
      (r) => !actualRoutes.includes(r),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        reasons: [`Missing required acceptance routes: ${missing.join(", ")}`],
      };
    }
    return { passed: true, reasons: [] };
  }
}
