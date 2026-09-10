import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AuditManager,
  SQLiteAuditStore,
  DecisionTraceDetails,
} from "../src/index.js";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, existsSync } from "fs";

function safelyRemoveDbFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err: any) {
    if (err && err.code !== "EBUSY" && err.code !== "ENOENT") {
      throw err;
    }
  }
}

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

  it("should persist audit events durably across SQLiteAuditStore reopening/restart", async () => {
    const dbPath = join(
      tmpdir(),
      `test_audit_restart_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
    );

    try {
      // Process A: Store1 writes audit event
      const store1 = new SQLiteAuditStore(dbPath);
      await store1.save({
        id: "evt_restart_001",
        type: "DECISION_MADE",
        timestamp: new Date(),
        workspaceId: "yartrader",
        taskId: "task_restart_1",
        severity: "HIGH",
        payload: {
          key: "value",
          token: "BEARER_TOKEN=secret_restart_token_999",
        },
      });
      store1.close();

      // Process B: Store2 reopens same SQLite DB
      const store2 = new SQLiteAuditStore(dbPath);
      const events = await store2.query({ taskId: "task_restart_1" });

      expect(events.length).toBe(1);
      expect(events[0].id).toBe("evt_restart_001");
      expect(events[0].workspaceId).toBe("yartrader");
      expect(events[0].payload.token).toContain("BEARER_TOKEN=[REDACTED]");
      expect(events[0].payload.token).not.toContain("secret_restart_token_999");

      store2.close();
    } finally {
      safelyRemoveDbFile(dbPath);
    }
  });
});
