import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { WorkflowEngine, WorkflowDefinition } from "../workflow/index.js";
import { ExecutionContext } from "../contracts/index.js";

const require = createRequire(import.meta.url);
const cronParser = require("cron-parser");

export type ScheduleType = "INTERVAL" | "ONCE" | "CRON";
export type ScheduleStatus = "SCHEDULED" | "DUE" | "COMPLETED" | "CANCELLED";

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerError";
  }
}

export interface ScheduleDefinition {
  id: string;
  type: ScheduleType;
  cronExpression?: string;
  intervalMs?: number;
  runAtUtc?: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  workflow?: WorkflowDefinition;
  enabled?: boolean;
}

export interface ScheduleRecord {
  id: string;
  type: ScheduleType;
  cronExpression?: string;
  intervalMs?: number;
  runAtUtc?: string;
  nextRunAtUtc: string;
  timezone: string;
  payload?: Record<string, unknown>;
  workflow?: WorkflowDefinition;
  status: ScheduleStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OccurrenceRecord {
  id: string;
  scheduleId: string;
  dueAtUtc: string;
  claimedAtUtc?: string;
  claimedBy?: string;
  status: "PENDING" | "CLAIMED" | "EXECUTED" | "SKIPPED" | "FAILED";
  executedAtUtc?: string;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class DurableScheduler {
  private db: any;

  constructor(
    dbPath: string = ":memory:",
    private workflowEngine?: WorkflowEngine,
    private clock: Clock = new SystemClock(),
  ) {
    if (dbPath !== ":memory:") {
      const parentDir = dirname(dbPath);
      if (parentDir && parentDir !== ".") {
        mkdirSync(parentDir, { recursive: true });
      }
    }
    const { DatabaseSync } = require("node:sqlite");
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        cron_expression TEXT,
        interval_ms INTEGER,
        run_at_utc TEXT,
        next_run_at_utc TEXT NOT NULL,
        timezone TEXT NOT NULL,
        payload_json TEXT,
        workflow_json TEXT,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        due_at_utc TEXT NOT NULL,
        claimed_at_utc TEXT,
        claimed_by TEXT,
        status TEXT NOT NULL,
        executed_at_utc TEXT,
        FOREIGN KEY(schedule_id) REFERENCES schedules(id)
      );
    `);
  }

  private validateScheduleInput(schedule: ScheduleDefinition): void {
    if (
      !schedule.id ||
      typeof schedule.id !== "string" ||
      schedule.id.trim().length === 0
    ) {
      throw new SchedulerError("Schedule ID must be a non-empty string.");
    }

    if (!["ONCE", "INTERVAL", "CRON"].includes(schedule.type)) {
      throw new SchedulerError(`Invalid schedule type '${schedule.type}'.`);
    }

    if (schedule.type === "ONCE") {
      if (!schedule.runAtUtc) {
        throw new SchedulerError("ONCE schedule requires runAtUtc timestamp.");
      }
      const runDate = new Date(schedule.runAtUtc);
      if (isNaN(runDate.getTime())) {
        throw new SchedulerError("Invalid runAtUtc timestamp.");
      }
    } else if (schedule.type === "INTERVAL") {
      if (
        !schedule.intervalMs ||
        typeof schedule.intervalMs !== "number" ||
        schedule.intervalMs <= 0
      ) {
        throw new SchedulerError(
          "INTERVAL schedule requires positive intervalMs.",
        );
      }
    } else if (schedule.type === "CRON") {
      if (!schedule.cronExpression) {
        throw new SchedulerError("CRON schedule requires cronExpression.");
      }
    }
  }

  public calculateNextDue(
    schedule: ScheduleDefinition,
    afterDate: Date,
  ): Date | null {
    if (schedule.enabled === false) return null;

    if (schedule.type === "ONCE") {
      if (!schedule.runAtUtc) return null;
      const target = new Date(schedule.runAtUtc);
      return target > afterDate ? target : null;
    }

    if (schedule.type === "INTERVAL") {
      if (!schedule.intervalMs) return null;
      return new Date(afterDate.getTime() + schedule.intervalMs);
    }

    if (schedule.type === "CRON") {
      if (!schedule.cronExpression) return null;
      try {
        const parser = cronParser.CronExpressionParser || cronParser.default;
        const interval = parser.parse(schedule.cronExpression, {
          currentDate: afterDate,
          tz: schedule.timezone || "UTC",
        });
        return interval.next().toDate();
      } catch (_err) {
        return null;
      }
    }

    return null;
  }

  createSchedule(schedule: ScheduleDefinition): ScheduleRecord {
    this.validateScheduleInput(schedule);

    const now = this.clock.now();
    const nextDue =
      this.calculateNextDue(schedule, now) ||
      (schedule.runAtUtc ? new Date(schedule.runAtUtc) : now);
    const timezone = schedule.timezone || "UTC";
    const status: ScheduleStatus = "SCHEDULED";
    const enabled = schedule.enabled !== false;
    const nowIso = now.toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO schedules (
        id, type, cron_expression, interval_ms, run_at_utc, next_run_at_utc,
        timezone, payload_json, workflow_json, status, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      schedule.id,
      schedule.type,
      schedule.cronExpression || null,
      schedule.intervalMs || null,
      schedule.runAtUtc || null,
      nextDue.toISOString(),
      timezone,
      schedule.payload ? JSON.stringify(schedule.payload) : null,
      schedule.workflow ? JSON.stringify(schedule.workflow) : null,
      status,
      enabled ? 1 : 0,
      nowIso,
      nowIso,
    );

    return this.getSchedule(schedule.id)!;
  }

  registerSchedule(schedule: ScheduleDefinition): void {
    this.createSchedule(schedule);
    this.scheduleNextOccurrence(schedule.id);
  }

  getSchedule(id: string): ScheduleRecord | null {
    if (!id || typeof id !== "string") return null;

    const stmt = this.db.prepare(`SELECT * FROM schedules WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      type: row.type as ScheduleType,
      cronExpression: row.cron_expression || undefined,
      intervalMs: row.interval_ms || undefined,
      runAtUtc: row.run_at_utc || undefined,
      nextRunAtUtc: row.next_run_at_utc,
      timezone: row.timezone,
      payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
      workflow: row.workflow_json ? JSON.parse(row.workflow_json) : undefined,
      status: row.status as ScheduleStatus,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSchedules(status?: ScheduleStatus): ScheduleRecord[] {
    let stmt;
    if (status) {
      stmt = this.db.prepare(
        `SELECT id FROM schedules WHERE status = ? ORDER BY next_run_at_utc ASC, created_at ASC, id ASC`,
      );
      const rows = stmt.all(status) as { id: string }[];
      return rows.map((r) => this.getSchedule(r.id)!);
    } else {
      stmt = this.db.prepare(
        `SELECT id FROM schedules ORDER BY next_run_at_utc ASC, created_at ASC, id ASC`,
      );
      const rows = stmt.all() as { id: string }[];
      return rows.map((r) => this.getSchedule(r.id)!);
    }
  }

  getDueSchedules(atTime?: Date): ScheduleRecord[] {
    const checkTimeIso = (atTime || this.clock.now()).toISOString();
    const stmt = this.db.prepare(`
      SELECT id FROM schedules
      WHERE status = 'SCHEDULED' AND enabled = 1 AND next_run_at_utc <= ?
      ORDER BY next_run_at_utc ASC, created_at ASC, id ASC
    `);

    const rows = stmt.all(checkTimeIso) as { id: string }[];
    return rows.map((r) => this.getSchedule(r.id)!);
  }

  completeSchedule(id: string): boolean {
    const schedule = this.getSchedule(id);
    if (!schedule) return false;

    const nowIso = this.clock.now().toISOString();
    const stmt = this.db.prepare(`
      UPDATE schedules
      SET status = 'COMPLETED', updated_at = ?
      WHERE id = ?
    `);

    stmt.run(nowIso, id);
    return true;
  }

  cancelSchedule(id: string): boolean {
    const schedule = this.getSchedule(id);
    if (!schedule) return false;

    const nowIso = this.clock.now().toISOString();
    const stmt = this.db.prepare(`
      UPDATE schedules
      SET status = 'CANCELLED', updated_at = ?
      WHERE id = ?
    `);

    stmt.run(nowIso, id);
    return true;
  }

  deleteSchedule(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM schedules WHERE id = ?`);
    const res = stmt.run(id);
    return typeof res.changes === "bigint"
      ? res.changes > 0n
      : (res.changes ?? 0) > 0;
  }

  scheduleNextOccurrence(
    scheduleId: string,
    fromDate?: Date,
  ): OccurrenceRecord | null {
    const s = this.getSchedule(scheduleId);
    if (!s || !s.enabled) return null;

    const baseTime = fromDate || this.clock.now();
    const dueAt = this.calculateNextDue(s, baseTime);
    if (!dueAt) return null;

    const occId = `occ_${s.id}_${dueAt.getTime()}`;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO occurrences (id, schedule_id, due_at_utc, status)
      VALUES (?, ?, ?, 'PENDING')
    `);

    stmt.run(occId, s.id, dueAt.toISOString());

    return this.getOccurrence(occId);
  }

  claimDueOccurrence(workerId: string): OccurrenceRecord | null {
    const nowIso = this.clock.now().toISOString();

    this.db.exec("BEGIN TRANSACTION;");
    try {
      const selectStmt = this.db.prepare(`
        SELECT * FROM occurrences
        WHERE status = 'PENDING' AND due_at_utc <= ?
        ORDER BY due_at_utc ASC LIMIT 1
      `);

      const row = selectStmt.get(nowIso);
      if (!row) {
        this.db.exec("COMMIT;");
        return null;
      }

      const updateStmt = this.db.prepare(`
        UPDATE occurrences
        SET status = 'CLAIMED', claimed_at_utc = ?, claimed_by = ?
        WHERE id = ? AND status = 'PENDING'
      `);

      const res = updateStmt.run(nowIso, workerId, row.id);
      const changes =
        typeof res.changes === "bigint"
          ? res.changes
          : BigInt(res.changes ?? 0);

      if (changes === 0n) {
        this.db.exec("ROLLBACK;");
        return null;
      }

      this.db.exec("COMMIT;");
      return this.getOccurrence(row.id);
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  async executeOccurrence(
    occurrenceId: string,
    executionId: string,
  ): Promise<boolean> {
    if (!this.workflowEngine) {
      throw new SchedulerError(
        "WorkflowEngine is required to execute occurrences.",
      );
    }

    const occ = this.getOccurrence(occurrenceId);
    if (!occ || occ.status !== "CLAIMED") return false;

    const s = this.getSchedule(occ.scheduleId);
    if (!s || !s.workflow) return false;

    const context: ExecutionContext = {
      executionId,
      timestamp: this.clock.now(),
    };

    const result = await this.workflowEngine.executeWorkflow(
      s.workflow,
      context,
    );

    const status = result.success ? "EXECUTED" : "FAILED";
    const nowIso = this.clock.now().toISOString();

    const updateStmt = this.db.prepare(`
      UPDATE occurrences
      SET status = ?, executed_at_utc = ?
      WHERE id = ?
    `);

    updateStmt.run(status, nowIso, occurrenceId);

    if (s.enabled && (s.type === "INTERVAL" || s.type === "CRON")) {
      this.scheduleNextOccurrence(s.id, new Date(occ.dueAtUtc));
    }

    return result.success;
  }

  handleMissedOccurrences(policy: "SKIP" | "RUN_ONCE"): number {
    const nowIso = this.clock.now().toISOString();
    if (policy === "SKIP") {
      const stmt = this.db.prepare(`
        UPDATE occurrences
        SET status = 'SKIPPED'
        WHERE status = 'PENDING' AND due_at_utc < ?
      `);
      const res = stmt.run(nowIso);
      return typeof res.changes === "bigint"
        ? Number(res.changes)
        : (res.changes ?? 0);
    } else if (policy === "RUN_ONCE") {
      const selectStmt = this.db.prepare(`
        SELECT id FROM occurrences
        WHERE status = 'PENDING' AND due_at_utc < ?
        ORDER BY due_at_utc DESC
      `);
      const rows = selectStmt.all(nowIso) as any[];
      if (rows.length <= 1) return 0;

      const skipIds = rows.slice(1).map((r) => r.id);
      let count = 0;
      for (const id of skipIds) {
        const stmt = this.db.prepare(
          `UPDATE occurrences SET status = 'SKIPPED' WHERE id = ?`,
        );
        stmt.run(id);
        count++;
      }
      return count;
    }
    return 0;
  }

  getOccurrence(id: string): OccurrenceRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM occurrences WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      scheduleId: row.schedule_id,
      dueAtUtc: row.due_at_utc,
      claimedAtUtc: row.claimed_at_utc || undefined,
      claimedBy: row.claimed_by || undefined,
      status: row.status,
      executedAtUtc: row.executed_at_utc || undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
