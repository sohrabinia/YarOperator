import { describe, it, expect, beforeEach } from "vitest";
import { DevelopmentTaskManager, AgentProfile } from "../src/index.js";

describe("DevelopmentTaskManager Foundation", () => {
  let taskManager: DevelopmentTaskManager;

  beforeEach(() => {
    taskManager = new DevelopmentTaskManager();
  });

  it("should create development tasks and transition statuses", () => {
    const task = taskManager.createTask({
      workspaceId: "yartrader",
      title: "Optimize trading terminal",
      description: "Profile and reduce render latency",
      goal: "Faster execution speed",
      priority: "high",
      risk: "APPROVAL_REQUIRED",
    });

    expect(task.id).toBeDefined();
    expect(task.status).toBe("CREATED");

    const updated = taskManager.updateTaskStatus(task.id, "IN_PROGRESS");
    expect(updated).toBe(true);

    const retrieved = taskManager.getTask(task.id);
    expect(retrieved?.status).toBe("IN_PROGRESS");
  });

  it("should filter development tasks by workspace", () => {
    taskManager.createTask({
      workspaceId: "yartrader",
      title: "Task 1",
      description: "D1",
      goal: "G1",
    });

    taskManager.createTask({
      workspaceId: "amlakbashi",
      title: "Task 2",
      description: "D2",
      goal: "G2",
    });

    const yartraderTasks = taskManager.listTasks({ workspaceId: "yartrader" });
    expect(yartraderTasks.length).toBe(1);
    expect(yartraderTasks[0].title).toBe("Task 1");
  });

  it("should register and list agent profiles", () => {
    const profile: AgentProfile = {
      id: "jules_worker",
      name: "Jules AI Worker",
      capabilities: ["code_generation", "refactoring"],
      status: "IDLE",
    };

    taskManager.registerAgentProfile(profile);

    const retrieved = taskManager.getAgentProfile("jules_worker");
    expect(retrieved?.name).toBe("Jules AI Worker");
    expect(taskManager.listAgentProfiles().length).toBe(1);
  });
});
