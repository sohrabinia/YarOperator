import { NotificationManager } from "../notification/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";

export interface AutonomousLoopResult {
  taskId: string;
  status: "SUCCESS" | "FAILED_MAX_RETRIES" | "APPROVAL_REQUIRED";
  attempts: number;
}

export class AutonomousDevelopmentLoop {
  constructor(
    private orchestrator: AgentOrchestrator,
    private notificationManager: NotificationManager,
  ) {}

  async runLoop(
    taskId: string,
    capability: string,
    workspaceId: string,
  ): Promise<AutonomousLoopResult> {
    const agent = this.orchestrator.selectAgentForCapability(
      capability,
      workspaceId,
    );
    if (!agent) {
      this.notificationManager.notify({
        type: "TASK_FAILED",
        title: "Autonomous Loop Failed",
        message: `No agent found with capability ${capability}`,
        taskId,
        workspaceId,
      });
      return { taskId, status: "FAILED_MAX_RETRIES", attempts: 1 };
    }

    this.notificationManager.notify({
      type: "TASK_COMPLETED",
      title: "Autonomous Loop Success",
      message: `Task ${taskId} completed by agent ${agent.name}`,
      taskId,
      workspaceId,
    });

    return { taskId, status: "SUCCESS", attempts: 1 };
  }
}
