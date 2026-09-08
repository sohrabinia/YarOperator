import { createRequire } from "module";
import { WorkflowEngine, WorkflowDefinition } from "../workflow/index.js";
import { ExecutionContext } from "../contracts/index.js";

const require = createRequire(import.meta.url);
const cronParser = require("cron-parser");

export type ScheduleType = "INTERVAL" | "ONCE" | "CRON";

export interface ScheduleDefinition {
  id: string;
  type: ScheduleType;
  cronExpression?: string;
  intervalMs?: number;
  runAtUtc?: string;
  timezone: string;
  workflow: WorkflowDefinition;
  enabled: boolean;
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
    private workflowEngine: WorkflowEngine,
    private clock: Clock = new SystemClock(),
  ) {
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
        timezone TEXT NOT NULL,
        workflow_json TEXT NOT NULL,
        enabled INTEGER NOT NULL
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

  registerSchedule(schedule: ScheduleDefinition): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO schedules (id, type, cron_expression, interval_ms, run_at_utc, timezone, workflow_json, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      schedule.id,
      schedule.type,
      schedule.cronExpression || null,
      schedule.intervalMs || null,
      schedule.runAtUtc || null,
      schedule.timezone,
      JSON.stringify(schedule.workflow),
      schedule.enabled ? 1 : 0,
    );

    this.scheduleNextOccurrence(schedule.id);
  }

  calculateNextDue(schedule: ScheduleDefinition, afterDate: Date): Date | null {
    if (!schedule.enabled) return null;

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

  scheduleNextOccurrence(
    scheduleId: string,
    fromDate?: Date,
  ): OccurrenceRecord | null {
    const schedStmt = this.db.prepare(`SELECT * FROM schedules WHERE id = ?`);
    const s = schedStmt.get(scheduleId);
    if (!s || !s.enabled) return null;

    const schedule: ScheduleDefinition = {
      id: s.id,
      type: s.type,
      cronExpression: s.cron_expression,
      intervalMs: s.interval_ms,
      runAtUtc: s.run_at_utc,
      timezone: s.timezone,
      workflow: JSON.parse(s.workflow_json),
      enabled: s.enabled === 1,
    };

    const baseTime = fromDate || this.clock.now();
    const dueAt = this.calculateNextDue(schedule, baseTime);
    if (!dueAt) return null;

    const occId = `occ_${schedule.id}_${dueAt.getTime()}`;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO occurrences (id, schedule_id, due_at_utc, status)
      VALUES (?, ?, ?, 'PENDING')
    `);

    stmt.run(occId, schedule.id, dueAt.toISOString());

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
    const occ = this.getOccurrence(occurrenceId);
    if (!occ || occ.status !== "CLAIMED") return false;

    const schedStmt = this.db.prepare(`SELECT * FROM schedules WHERE id = ?`);
    const s = schedStmt.get(occ.scheduleId);
    if (!s) return false;

    const workflow: WorkflowDefinition = JSON.parse(s.workflow_json);
    const context: ExecutionContext = {
      executionId,
      timestamp: this.clock.now(),
    };

    const result = await this.workflowEngine.executeWorkflow(workflow, context);

    const status = result.success ? "EXECUTED" : "FAILED";
    const nowIso = this.clock.now().toISOString();

    const updateStmt = this.db.prepare(`
      UPDATE occurrences
      SET status = ?, executed_at_utc = ?
      WHERE id = ?
    `);

    updateStmt.run(status, nowIso, occurrenceId);

    if (s.enabled === 1 && (s.type === "INTERVAL" || s.type === "CRON")) {
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
