import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NotificationManager } from "../src/core/notification/index.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 3: Notification Manager Durability", () => {
  const dbPath = "test_notification_durability.db";
  let manager: NotificationManager;

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    manager = new NotificationManager(dbPath);
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {}
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. notification created and remains available across restart", () => {
    const notif = manager.notify({
      type: "APPROVAL_REQUIRED",
      priority: "HIGH",
      title: "Approval Needed for Git Commit",
      message: "Action git_operate:commit requires owner confirmation",
      workspaceId: "yartrader",
      taskId: "task_456",
      metadata: { action: "git_operate:commit", branch: "main" },
    });

    expect(notif.id).toBeDefined();

    manager.close();
    const manager2 = new NotificationManager(dbPath);

    const rehydratedList = manager2.listNotifications({
      workspaceId: "yartrader",
    });

    expect(rehydratedList.length).toBe(1);
    expect(rehydratedList[0].id).toBe(notif.id);
    expect(rehydratedList[0].title).toBe("Approval Needed for Git Commit");
    expect(rehydratedList[0].priority).toBe("HIGH");
    expect(rehydratedList[0].taskId).toBe("task_456");
    expect(rehydratedList[0].read).toBe(false);

    manager2.close();
  });

  it("2. acknowledged notification remains acknowledged after restart", () => {
    const notif = manager.notify({
      type: "TASK_COMPLETED",
      priority: "LOW",
      title: "Build Successful",
      message: "Task completed successfully",
      workspaceId: "yartrader",
    });

    manager.markAsRead(notif.id);

    manager.close();
    const manager2 = new NotificationManager(dbPath);

    const rehydratedList = manager2.listNotifications({
      workspaceId: "yartrader",
    });

    expect(rehydratedList.length).toBe(1);
    expect(rehydratedList[0].read).toBe(true);

    const unreadOnly = manager2.listNotifications({
      workspaceId: "yartrader",
      unreadOnly: true,
    });

    expect(unreadOnly.length).toBe(0);

    manager2.close();
  });

  it("3. workspace isolation remains intact", () => {
    manager.notify({
      type: "STATUS_UPDATE",
      title: "Workspace A Event",
      message: "Event in A",
      workspaceId: "workspace_a",
    });

    manager.notify({
      type: "STATUS_UPDATE",
      title: "Workspace B Event",
      message: "Event in B",
      workspaceId: "workspace_b",
    });

    manager.close();
    const manager2 = new NotificationManager(dbPath);

    const listA = manager2.listNotifications({ workspaceId: "workspace_a" });
    expect(listA.length).toBe(1);
    expect(listA[0].title).toBe("Workspace A Event");

    const listB = manager2.listNotifications({ workspaceId: "workspace_b" });
    expect(listB.length).toBe(1);
    expect(listB[0].title).toBe("Workspace B Event");

    manager2.close();
  });
});
