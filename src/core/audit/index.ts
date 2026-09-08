import { AuditEvent } from "../contracts/index.js";

export class AuditLogger {
  private events: AuditEvent[] = [];

  log(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
    const fullEvent: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
      ...event,
    };
    this.events.push(fullEvent);
    return fullEvent;
  }

  getEvents(executionId?: string): AuditEvent[] {
    if (executionId) {
      return this.events.filter((e) => e.executionId === executionId);
    }
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
