import { describe, it, expect, beforeEach } from "vitest";
import { AuditManager, DecisionTraceDetails } from "../src/index.js";

describe("AuditManager Execution Logging & Self Audit Foundation", () => {
  let auditManager: AuditManager;

  beforeEach(() => {
    auditManager = new AuditManager();
  });

  it("should record and query audit events with workspace and task filtering", async () => {
    await auditManager.recordEvent(
      "TASK_CREATED",
      { goal: "SEO Analysis" },
      { workspaceId: "amlakbashi", taskId: "task_1" },
    );

    await auditManager.recordEvent(
      "TASK_CREATED",
      { goal: "Terminal test" },
      { workspaceId: "yartrader", taskId: "task_2" },
    );

    const amlakbashiEvents = await auditManager.queryEvents({
      workspaceId: "amlakbashi",
    });
    expect(amlakbashiEvents.length).toBe(1);
    expect(amlakbashiEvents[0].taskId).toBe("task_1");
  });

  it("should support decision trace recording with rationale and alternatives", async () => {
    const trace: DecisionTraceDetails = {
      decision: "Select Node.js terminal adapter",
      reason: "Cross-platform compatibility requirement",
      alternatives: ["Bash direct execution"],
      result: "Success",
    };

    const evt = await auditManager.recordEvent(
      "DECISION_MADE",
      { component: "terminal" },
      { workspaceId: "yartrader", decisionTrace: trace, severity: "MEDIUM" },
    );

    expect(evt.type).toBe("DECISION_MADE");
    expect(evt.decisionTrace?.reason).toContain("Cross-platform");
    expect(evt.severity).toBe("MEDIUM");
  });

  it("should record action failure events", async () => {
    const evt = await auditManager.recordEvent(
      "ACTION_FAILED",
      { command: "invalid_cmd", error: "Command not found" },
      { workspaceId: "yartrader", severity: "HIGH" },
    );

    expect(evt.type).toBe("ACTION_FAILED");
    expect(evt.severity).toBe("HIGH");
    expect(evt.payload.error).toBe("Command not found");
  });
});
