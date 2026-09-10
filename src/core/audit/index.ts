import { AuditEvent as BasicAuditEvent } from "../contracts/index.js";
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname } from "path";

const require = createRequire(import.meta.url);

export type AuditEventType =
  | "TASK_CREATED"
  | "DECISION_MADE"
  | "ACTION_STARTED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "REVIEW_COMPLETED";

export type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DecisionTraceDetails {
  decision: string;
  reason: string;
  alternatives?: string[];
  result?: string;
}

export interface DetailedAuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: Date;
  workspaceId?: string;
  taskId?: string;
  contextId?: string;
  payload: Record<string, unknown>;
  decisionTrace?: DecisionTraceDetails;
  severity: AuditSeverity;
}

export interface AuditQueryFilter {
  workspaceId?: string;
  taskId?: string;
  type?: AuditEventType;
  severity?: AuditSeverity;
}

export interface AuditStore {
  save(event: DetailedAuditEvent): Promise<void>;
  query(filter: AuditQueryFilter): Promise<DetailedAuditEvent[]>;
}

export class InMemoryAuditStore implements AuditStore {
  private events: DetailedAuditEvent[] = [];

  async save(event: DetailedAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async query(filter: AuditQueryFilter): Promise<DetailedAuditEvent[]> {
    return this.events.filter((e) => {
      if (filter.workspaceId && e.workspaceId !== filter.workspaceId)
        return false;
      if (filter.taskId && e.taskId !== filter.taskId) return false;
      if (filter.type && e.type !== filter.type) return false;
      if (filter.severity && e.severity !== filter.severity) return false;
      return true;
    });
  }
}

export class SQLiteAuditStore implements AuditStore {
  private db: any;

  constructor(dbPath: string = process.env.OPERATOR_DB_PATH || "operator.db") {
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
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        workspace_id TEXT,
        task_id TEXT,
        context_id TEXT,
        payload TEXT NOT NULL,
        decision_trace TEXT,
        severity TEXT NOT NULL
      );
    `);
  }

  async save(event: DetailedAuditEvent): Promise<void> {
    const redactedPayload = this.redactSecretsInObject(event.payload || {});
    const redactedTrace = event.decisionTrace
      ? this.redactSecretsInObject(event.decisionTrace)
      : null;

    const jsonPayload = JSON.stringify(redactedPayload);
    const jsonTrace = redactedTrace ? JSON.stringify(redactedTrace) : null;

    const stmt = this.db.prepare(`
      INSERT INTO audit_events (id, type, timestamp, workspace_id, task_id, context_id, payload, decision_trace, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.type,
      event.timestamp.toISOString(),
      event.workspaceId || null,
      event.taskId || null,
      event.contextId || null,
      jsonPayload,
      jsonTrace,
      event.severity,
    );
  }

  private redactSecretsInObject(obj: any): any {
    if (typeof obj === "string") {
      return this.redactSecretsInString(obj);
    }
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactSecretsInObject(item));
    }
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (
        /(PASSWORD|SECRET|TOKEN|BEARER|AUTH|API_KEY|COOKIE|SESSION)/i.test(key)
      ) {
        if (typeof val === "string") {
          cleanObj[key] = this.redactSecretsInString(val);
        } else {
          cleanObj[key] = "[REDACTED]";
        }
      } else {
        cleanObj[key] = this.redactSecretsInObject(val);
      }
    }
    return cleanObj;
  }

  private redactSecretsInString(text: string): string {
    if (!text) return "";
    return text.replace(
      /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER|COOKIE|SESSION)[=:\s]+[^\s"'&,]+/gi,
      (_match, key) => `${key}=[REDACTED]`,
    );
  }

  async query(filter: AuditQueryFilter): Promise<DetailedAuditEvent[]> {
    let sql = `SELECT id, type, timestamp, workspace_id, task_id, context_id, payload, decision_trace, severity FROM audit_events WHERE 1=1`;
    const params: any[] = [];

    if (filter.workspaceId) {
      sql += ` AND workspace_id = ?`;
      params.push(filter.workspaceId);
    }
    if (filter.taskId) {
      sql += ` AND task_id = ?`;
      params.push(filter.taskId);
    }
    if (filter.type) {
      sql += ` AND type = ?`;
      params.push(filter.type);
    }
    if (filter.severity) {
      sql += ` AND severity = ?`;
      params.push(filter.severity);
    }

    sql += ` ORDER BY timestamp ASC`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type as AuditEventType,
      timestamp: new Date(r.timestamp),
      workspaceId: r.workspace_id || undefined,
      taskId: r.task_id || undefined,
      contextId: r.context_id || undefined,
      payload: JSON.parse(r.payload || "{}"),
      decisionTrace: r.decision_trace
        ? JSON.parse(r.decision_trace)
        : undefined,
      severity: r.severity as AuditSeverity,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export class AuditLogger {
  private events: BasicAuditEvent[] = [];

  log(event: Omit<BasicAuditEvent, "id" | "timestamp">): BasicAuditEvent {
    const fullEvent: BasicAuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
      ...event,
    };
    this.events.push(fullEvent);
    return fullEvent;
  }

  getEvents(executionId?: string): BasicAuditEvent[] {
    if (executionId) {
      return this.events.filter((e) => e.executionId === executionId);
    }
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export class AuditManager {
  constructor(private store: AuditStore = new InMemoryAuditStore()) {}

  async recordEvent(
    type: AuditEventType,
    payload: Record<string, unknown>,
    options?: {
      workspaceId?: string;
      taskId?: string;
      contextId?: string;
      decisionTrace?: DecisionTraceDetails;
      severity?: AuditSeverity;
    },
  ): Promise<DetailedAuditEvent> {
    const event: DetailedAuditEvent = {
      id: `audit_evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      timestamp: new Date(),
      workspaceId: options?.workspaceId,
      taskId: options?.taskId,
      contextId: options?.contextId,
      payload,
      decisionTrace: options?.decisionTrace,
      severity: options?.severity || "LOW",
    };

    await this.store.save(event);
    return event;
  }

  async queryEvents(filter: AuditQueryFilter): Promise<DetailedAuditEvent[]> {
    return this.store.query(filter);
  }
}
