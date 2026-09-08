import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DurableScheduler,
  WorkflowEngine,
  ExecutionEngine,
  ToolRegistry,
  AuditLogger,
  ScheduleDefinition,
  Clock,
  Tool,
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

class TestClock implements Clock {
  constructor(private currentTime: Date) {}

  now(): Date {
    return new Date(this.currentTime);
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

describe("DurableScheduler Operator", () => {
  const dbFile = join(tmpdir(), "test_scheduler.db");
  let registry: ToolRegistry;
  let auditLogger: AuditLogger;
  let executionEngine: ExecutionEngine;
  let workflowEngine: WorkflowEngine;
  let clock: TestClock;

  beforeEach(() => {
    if (existsSync(dbFile)) unlinkSync(dbFile);

    registry = new ToolRegistry();
    auditLogger = new AuditLogger();
    executionEngine = new ExecutionEngine(registry, auditLogger);
    workflowEngine = new WorkflowEngine(executionEngine, auditLogger);
    clock = new TestClock(new Date("2026-01-01T00:00:00.000Z"));

    const dummyTool: Tool = {
      metadata: {
        id: "sched_tool",
        name: "Sched Tool",
        description: "st",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true, output: { ran: true } }),
    };
    registry.register(dummyTool);
  });

  afterEach(() => {
    if (existsSync(dbFile)) unlinkSync(dbFile);
  });

  it("should register schedule and compute next due occurrence deterministically", () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "interval_sched",
      type: "INTERVAL",
      intervalMs: 60000,
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_sched",
        name: "Sched WF",
        steps: [{ id: "step1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);

    clock.advance(60001);
    const claimed = scheduler.claimDueOccurrence("worker_1");

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("CLAIMED");
    expect(claimed?.claimedBy).toBe("worker_1");

    scheduler.close();
  });

  it("should enforce transactional single claim and prevent duplicate worker executions", () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "once_sched",
      type: "ONCE",
      runAtUtc: "2026-01-01T01:00:00.000Z",
      timezone: "America/New_York",
      enabled: true,
      workflow: {
        id: "wf_once",
        name: "Once WF",
        steps: [{ id: "step1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);

    clock.advance(3600001);

    const claim1 = scheduler.claimDueOccurrence("worker_1");
    const claim2 = scheduler.claimDueOccurrence("worker_2");

    expect(claim1).not.toBeNull();
    expect(claim2).toBeNull();
    scheduler.close();
  });

  it("should execute claimed occurrence and link directly to WorkflowEngine execution", async () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "exec_sched",
      type: "INTERVAL",
      intervalMs: 1000,
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_link",
        name: "Link WF",
        steps: [{ id: "s1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);
    clock.advance(2000);

    const claimed = scheduler.claimDueOccurrence("worker_1");
    expect(claimed).not.toBeNull();

    const executed = await scheduler.executeOccurrence(
      claimed!.id,
      "exec_ctx_999",
    );
    expect(executed).toBe(true);

    const updatedOcc = scheduler.getOccurrence(claimed!.id);
    expect(updatedOcc?.status).toBe("EXECUTED");
    scheduler.close();
  });

  it("should handle missed occurrences according to explicit SKIP policy", () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "missed_sched",
      type: "INTERVAL",
      intervalMs: 1000,
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_m",
        name: "M WF",
        steps: [{ id: "s1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);
    clock.advance(5000);

    const skippedCount = scheduler.handleMissedOccurrences("SKIP");
    expect(skippedCount).toBe(1);

    const claimed = scheduler.claimDueOccurrence("worker_1");
    expect(claimed).toBeNull();
    scheduler.close();
  });
});
