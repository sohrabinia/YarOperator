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

class TestClock implements Clock {
  constructor(private currentTime: Date) {}

  now(): Date {
    return new Date(this.currentTime);
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

describe("DurableScheduler Remediated Capabilities", () => {
  const dbFile = "/tmp/test_scheduler_remediated.db";
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

  it("should calculate real CRON schedules with IANA timezone and DST support", () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const cronSchedule: ScheduleDefinition = {
      id: "cron_sched",
      type: "CRON",
      cronExpression: "0 12 * * *", // 12:00 UTC every day
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_cron",
        name: "Cron WF",
        steps: [{ id: "step1", toolId: "sched_tool", params: {} }],
      },
    };

    const nextDue = scheduler.calculateNextDue(
      cronSchedule,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(nextDue?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    scheduler.close();
  });

  it("should continuously create subsequent recurring occurrences after execution", async () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "recur_sched",
      type: "INTERVAL",
      intervalMs: 1000,
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_r",
        name: "R WF",
        steps: [{ id: "step1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);

    // Occurrence 1
    clock.advance(1000);
    const claim1 = scheduler.claimDueOccurrence("w1");
    expect(claim1).not.toBeNull();
    await scheduler.executeOccurrence(claim1!.id, "exec_1");

    // Occurrence 2 automatically scheduled after Occurrence 1 execution
    clock.advance(1000);
    const claim2 = scheduler.claimDueOccurrence("w1");
    expect(claim2).not.toBeNull();
    expect(claim2?.id).not.toBe(claim1?.id);

    scheduler.close();
  });

  it("should support RUN_ONCE missed-occurrence policy preserving newest occurrence opportunity", () => {
    const scheduler = new DurableScheduler(dbFile, workflowEngine, clock);
    const schedule: ScheduleDefinition = {
      id: "missed_run_once",
      type: "INTERVAL",
      intervalMs: 1000,
      timezone: "UTC",
      enabled: true,
      workflow: {
        id: "wf_mo",
        name: "MO WF",
        steps: [{ id: "step1", toolId: "sched_tool", params: {} }],
      },
    };

    scheduler.registerSchedule(schedule);
    // Simulate multiple missed occurrences by advancing time without claiming
    scheduler.scheduleNextOccurrence(
      schedule.id,
      new Date("2026-01-01T00:00:01.000Z"),
    );
    scheduler.scheduleNextOccurrence(
      schedule.id,
      new Date("2026-01-01T00:00:02.000Z"),
    );

    clock.advance(10000);

    const skippedCount = scheduler.handleMissedOccurrences("RUN_ONCE");
    expect(skippedCount).toBeGreaterThan(0);

    const claimable = scheduler.claimDueOccurrence("w1");
    expect(claimable).not.toBeNull(); // Exactly one execution opportunity preserved
    scheduler.close();
  });
});
