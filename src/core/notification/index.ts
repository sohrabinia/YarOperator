export type NotificationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type NotificationType =
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "APPROVAL_REQUIRED"
  | "ESCALATION"
  | "STATUS_UPDATE"
  | "SUMMARY_REPORT";

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  workspaceId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  read: boolean;
}

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

export class NotificationManager {
  private notifications: Notification[] = [];
  private db: any = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      if (dbPath !== ":memory:") {
        const parentDir = dirname(dbPath);
        if (parentDir && parentDir !== ".") {
          mkdirSync(parentDir, { recursive: true });
        }
      }
      const { DatabaseSync } = require("node:sqlite");
      this.db = new DatabaseSync(dbPath);
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      try {
        this.initSchema();
        this.rehydrate();
      } catch (err) {
        if (this.db) {
          try {
            this.db.close();
          } catch {}
          this.db = null;
        }
        throw err;
      }
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        workspace_id TEXT,
        task_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL
      );
    `);
  }

  private rehydrate(): void {
    if (!this.db) return;
    const stmt = this.db.prepare(
      `SELECT * FROM notifications ORDER BY created_at ASC`,
    );
    const rows = stmt.all() as any[];

    const validTypes = new Set<NotificationType>([
      "TASK_COMPLETED",
      "TASK_FAILED",
      "APPROVAL_REQUIRED",
      "ESCALATION",
      "STATUS_UPDATE",
      "SUMMARY_REPORT",
    ]);

    const validPriorities = new Set<NotificationPriority>([
      "LOW",
      "MEDIUM",
      "HIGH",
      "URGENT",
    ]);

    for (const row of rows) {
      let metadata: Record<string, unknown> | undefined;
      if (row.metadata_json) {
        try {
          metadata = JSON.parse(row.metadata_json);
        } catch {
          throw new Error(
            `PERSISTENCE CORRUPTION FAILURE: Notification record '${row.id}' contains corrupt JSON metadata.`,
          );
        }
      }

      if (!validTypes.has(row.type as NotificationType)) {
        throw new Error(
          `PERSISTENCE CORRUPTION FAILURE: Notification record '${row.id}' contains invalid type '${row.type}'.`,
        );
      }

      if (!validPriorities.has(row.priority as NotificationPriority)) {
        throw new Error(
          `PERSISTENCE CORRUPTION FAILURE: Notification record '${row.id}' contains invalid priority '${row.priority}'.`,
        );
      }

      const notif: Notification = {
        id: row.id,
        type: row.type as NotificationType,
        priority: row.priority as NotificationPriority,
        title: row.title,
        message: row.message,
        workspaceId: row.workspace_id || undefined,
        taskId: row.task_id || undefined,
        metadata,
        createdAt: new Date(Number(row.created_at)),
        read: Boolean(row.read),
      };

      this.notifications.push(notif);
    }
  }

  private persistNotification(notif: Notification): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO notifications (
        id, type, priority, title, message, workspace_id, task_id, metadata_json, created_at, read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      notif.id,
      notif.type,
      notif.priority,
      notif.title,
      notif.message,
      notif.workspaceId || null,
      notif.taskId || null,
      notif.metadata ? JSON.stringify(notif.metadata) : null,
      notif.createdAt.getTime(),
      notif.read ? 1 : 0,
    );
  }

  notify(params: {
    type: NotificationType;
    priority?: NotificationPriority;
    title: string;
    message: string;
    workspaceId?: string;
    taskId?: string;
    metadata?: Record<string, unknown>;
  }): Notification {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: params.type,
      priority: params.priority || "MEDIUM",
      title: params.title,
      message: params.message,
      workspaceId: params.workspaceId,
      taskId: params.taskId,
      metadata: params.metadata,
      createdAt: new Date(),
      read: false,
    };

    if (this.db) {
      this.persistNotification(notification);
    }
    this.notifications.push(notification);
    return notification;
  }

  listNotifications(filter?: {
    workspaceId?: string;
    type?: NotificationType;
    priority?: NotificationPriority;
    unreadOnly?: boolean;
  }): Notification[] {
    if (this.db) {
      this.notifications = [];
      this.rehydrate();
    }
    return this.notifications.filter((n) => {
      if (filter?.workspaceId && n.workspaceId !== filter.workspaceId)
        return false;
      if (filter?.type && n.type !== filter.type) return false;
      if (filter?.priority && n.priority !== filter.priority) return false;
      if (filter?.unreadOnly && n.read) return false;
      return true;
    });
  }

  markAsRead(id: string): boolean {
    if (this.db) {
      const stmt = this.db.prepare(
        `UPDATE notifications SET read = 1 WHERE id = ?`,
      );
      const res = stmt.run(id);
      const changes =
        typeof res.changes === "bigint"
          ? Number(res.changes)
          : (res.changes ?? 0);

      if (changes > 0) {
        const memoryNotif = this.notifications.find((n) => n.id === id);
        if (memoryNotif) memoryNotif.read = true;
        return true;
      }
      return false;
    }

    const notif = this.notifications.find((n) => n.id === id);
    if (!notif) return false;
    notif.read = true;
    return true;
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
}
