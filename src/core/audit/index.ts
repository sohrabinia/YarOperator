import { AuditEvent as BasicAuditEvent } from "../contracts/index.js";

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
