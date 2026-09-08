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

export class NotificationManager {
  private notifications: Notification[] = [];

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

    this.notifications.push(notification);
    return notification;
  }

  listNotifications(filter?: {
    workspaceId?: string;
    type?: NotificationType;
    priority?: NotificationPriority;
    unreadOnly?: boolean;
  }): Notification[] {
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
    const notif = this.notifications.find((n) => n.id === id);
    if (!notif) return false;
    notif.read = true;
    return true;
  }
}
