export type DevelopmentTaskStatus =
  | "CREATED"
  | "PLANNED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED";

export interface DevelopmentTask {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  goal: string;
  priority: "low" | "medium" | "high" | "critical";
  risk: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  status: DevelopmentTaskStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentProfile {
  id: string;
  name: string;
  capabilities: string[];
  status: "IDLE" | "BUSY" | "OFFLINE";
}

export interface TaskManagerFilter {
  workspaceId?: string;
  status?: DevelopmentTaskStatus;
  priority?: "low" | "medium" | "high" | "critical";
}

export class DevelopmentTaskManager {
  private tasks = new Map<string, DevelopmentTask>();
  private agentProfiles = new Map<string, AgentProfile>();

  createTask(params: {
    workspaceId: string;
    title: string;
    description: string;
    goal: string;
    priority?: "low" | "medium" | "high" | "critical";
    risk?: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  }): DevelopmentTask {
    const now = new Date();
    const task: DevelopmentTask = {
      id: `dev_task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: params.workspaceId,
      title: params.title,
      description: params.description,
      goal: params.goal,
      priority: params.priority || "medium",
      risk: params.risk || "SAFE",
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    return task;
  }

  getTask(id: string): DevelopmentTask | undefined {
    return this.tasks.get(id);
  }

  updateTaskStatus(id: string, status: DevelopmentTaskStatus): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.status = status;
    task.updatedAt = new Date();
    return true;
  }

  listTasks(filter?: TaskManagerFilter): DevelopmentTask[] {
    const all = Array.from(this.tasks.values());
    if (!filter) return all;

    return all.filter((t) => {
      if (filter.workspaceId && t.workspaceId !== filter.workspaceId)
        return false;
      if (filter.status && t.status !== filter.status) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      return true;
    });
  }

  registerAgentProfile(profile: AgentProfile): void {
    this.agentProfiles.set(profile.id, profile);
  }

  getAgentProfile(id: string): AgentProfile | undefined {
    return this.agentProfiles.get(id);
  }

  listAgentProfiles(): AgentProfile[] {
    return Array.from(this.agentProfiles.values());
  }
}
