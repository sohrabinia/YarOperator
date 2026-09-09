import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DurableScheduler,
  ScheduleDefinition,
  SchedulerError,
} from "../src/index.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Phase 8.2 — Durable Scheduler Primitive", () => {
  const dbFile = join(tmpdir(), "test_durable_scheduler_p82.db");

  beforeEach(() => {
    if (existsSync(dbFile)) unlinkSync(dbFile);
  });

  afterEach(() => {
    if (existsSync(dbFile)) unlinkSync(dbFile);
  });

  it("should create, persist, retrieve, list, and delete schedule definitions", () => {
    const scheduler = new DurableScheduler(dbFile);

    const sched: ScheduleDefinition = {
      id: "sched_1",
      type: "ONCE",
      runAtUtc: "2026-06-01T12:00:00.000Z",
      payload: { taskId: "t_100", action: "sync" },
    };

    const record = scheduler.createSchedule(sched);
    expect(record.id).toBe("sched_1");
    expect(record.status).toBe("SCHEDULED");
    expect(record.payload).toEqual({ taskId: "t_100", action: "sync" });

    const retrieved = scheduler.getSchedule("sched_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("sched_1");

    const list = scheduler.listSchedules();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("sched_1");

    const deleted = scheduler.deleteSchedule("sched_1");
    expect(deleted).toBe(true);
    expect(scheduler.getSchedule("sched_1")).toBeNull();

    scheduler.close();
  });

  it("should prove durability across scheduler instance disposal and store recreation", () => {
    let scheduler1 = new DurableScheduler(dbFile);
    scheduler1.createSchedule({
      id: "durable_sched_1",
      type: "INTERVAL",
      intervalMs: 5000,
      timezone: "UTC",
      payload: { jobName: "nightly_cleanup" },
    });
    scheduler1.close();

    // Recreate scheduler instance using same underlying database store
    let scheduler2 = new DurableScheduler(dbFile);
    const reloaded = scheduler2.getSchedule("durable_sched_1");

    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe("durable_sched_1");
    expect(reloaded?.type).toBe("INTERVAL");
    expect(reloaded?.payload).toEqual({ jobName: "nightly_cleanup" });

    scheduler2.close();
  });

  it("should evaluate due schedules deterministically for <, ==, and > supplied timestamps", () => {
    const scheduler = new DurableScheduler(dbFile);

    // Schedule 1: Due in past
    scheduler.createSchedule({
      id: "past_due",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
    });

    // Schedule 2: Due exactly at check time
    scheduler.createSchedule({
      id: "exact_due",
      type: "ONCE",
      runAtUtc: "2026-01-01T12:00:00.000Z",
    });

    // Schedule 3: Future schedule (not due)
    scheduler.createSchedule({
      id: "future_due",
      type: "ONCE",
      runAtUtc: "2026-01-01T14:00:00.000Z",
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const dueSchedules = scheduler.getDueSchedules(checkTime);

    expect(dueSchedules.length).toBe(2);
    expect(dueSchedules.map((s) => s.id)).toEqual(["past_due", "exact_due"]);

    scheduler.close();
  });

  it("should return multiple due schedules in deterministic order", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "s_later",
      type: "ONCE",
      runAtUtc: "2026-01-01T11:00:00.000Z",
    });

    scheduler.createSchedule({
      id: "s_earlier",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
    });

    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    const dueSchedules = scheduler.getDueSchedules(checkTime);

    expect(dueSchedules.length).toBe(2);
    expect(dueSchedules[0].id).toBe("s_earlier");
    expect(dueSchedules[1].id).toBe("s_later");

    scheduler.close();
  });

  it("should support valid lifecycle state transitions to COMPLETED and CANCELLED", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "s_complete",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
    });

    scheduler.createSchedule({
      id: "s_cancel",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
    });

    scheduler.completeSchedule("s_complete");
    scheduler.cancelSchedule("s_cancel");

    expect(scheduler.getSchedule("s_complete")?.status).toBe("COMPLETED");
    expect(scheduler.getSchedule("s_cancel")?.status).toBe("CANCELLED");

    // Completed or cancelled schedules are no longer returned in getDueSchedules
    const checkTime = new Date("2026-01-01T12:00:00.000Z");
    expect(scheduler.getDueSchedules(checkTime).length).toBe(0);

    scheduler.close();
  });

  it("should reject malformed schedule definitions with structured SchedulerError", () => {
    const scheduler = new DurableScheduler(dbFile);

    expect(() =>
      scheduler.createSchedule({
        id: "",
        type: "ONCE",
        runAtUtc: "2026-01-01T10:00:00.000Z",
      }),
    ).toThrow(SchedulerError);

    expect(() =>
      scheduler.createSchedule({
        id: "s_invalid_type",
        type: "UNKNOWN" as any,
      }),
    ).toThrow("Invalid schedule type 'UNKNOWN'");

    expect(() =>
      scheduler.createSchedule({
        id: "s_invalid_date",
        type: "ONCE",
        runAtUtc: "not_a_valid_date",
      }),
    ).toThrow("Invalid runAtUtc timestamp");

    scheduler.close();
  });

  it("should maintain schedule isolation and avoid cross-schedule parameter bleeding", () => {
    const scheduler = new DurableScheduler(dbFile);

    scheduler.createSchedule({
      id: "job_a",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      payload: { env: "prod", worker: "w1" },
    });

    scheduler.createSchedule({
      id: "job_b",
      type: "ONCE",
      runAtUtc: "2026-01-01T10:00:00.000Z",
      payload: { env: "staging", worker: "w2" },
    });

    const jobA = scheduler.getSchedule("job_a");
    const jobB = scheduler.getSchedule("job_b");

    expect(jobA?.payload).toEqual({ env: "prod", worker: "w1" });
    expect(jobB?.payload).toEqual({ env: "staging", worker: "w2" });

    scheduler.close();
  });
});
