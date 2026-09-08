import { Snapshot } from "../baseline/index.js";

export interface RegressionFinding {
  hasRegression: boolean;
  diffSummary: string[];
}

export class RegressionEngine {
  compare(base: Snapshot, current: Snapshot): RegressionFinding {
    const diffs: string[] = [];
    if (base.domTreeHash !== current.domTreeHash) {
      diffs.push("DOM Tree Hash mismatch detected.");
    }
    if (base.screenshotHash !== current.screenshotHash) {
      diffs.push("Visual screenshot Hash mismatch detected.");
    }
    return {
      hasRegression: diffs.length > 0,
      diffSummary: diffs,
    };
  }
}
