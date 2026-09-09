import { NotificationManager } from "../notification/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { DurableScheduler } from "../scheduler/index.js";
import { DurableOperationalMemory } from "../memory/index.js";
import {
  ControlledAutonomyEngine,
  AutonomousActionRequest,
  AutonomyBudget,
} from "../autonomy/index.js";
import { ExecutionContext } from "../contracts/index.js";

export interface AutonomousLoopResult {
  taskId: string;
  status:
    | "SUCCESS"
    | "FAILED_MAX_RETRIES"
    | "APPROVAL_REQUIRED"
    | "SKIPPED"
    | "BLOCKED";
  attempts: number;
  details?: string;
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

export class AutonomousExecutionLoop {
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private scheduler: DurableScheduler,
    private memory: DurableOperationalMemory,
    private autonomyEngine: ControlledAutonomyEngine,
    private pollIntervalMs: number = 5000,
  ) {}

  public getRunningState(): boolean {
    return this.isRunning;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.recover();

    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.tick();
    }, this.pollIntervalMs);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async recover(): Promise<{
    staleClaimsReconciled: number;
    pendingRetriesRecovered: number;
  }> {
    const staleClaims = this.scheduler.reconcileStaleClaims(300000);
    const retryRecovery = this.autonomyEngine.recoverInterruptedTasks();

    return {
      staleClaimsReconciled: staleClaims,
      pendingRetriesRecovered: retryRecovery.recoveredCount,
    };
  }

  public async tick(
    atTime: Date = new Date(),
  ): Promise<AutonomousLoopResult[]> {
    const results: AutonomousLoopResult[] = [];
    const dueSchedules = this.scheduler.getDueSchedules(atTime);

    if (dueSchedules.length === 0) {
      return results;
    }

    for (const schedule of dueSchedules) {
      const payload = schedule.payload || {};
      const taskId = (payload.taskId as string) || `task_sched_${schedule.id}`;
      const workspaceId = (payload.workspaceId as string) || "yartrader";
      const toolId = (payload.toolId as string) || "git_operate";

      const request: AutonomousActionRequest = {
        taskId,
        workspaceId,
        toolId,
        params: payload.params || {},
        capability: (payload.capability as string) || "software-development",
      };

      const budget: AutonomyBudget = {
        maxActions: 5,
        maxRetries: 3,
        maxReplans: 1,
        usedActions: 0,
        usedRetries: 0,
        usedReplans: 0,
      };

      const context: ExecutionContext = {
        executionId: `loop_exec_${Date.now()}_${schedule.id}`,
        timestamp: atTime,
      };

      const actionResult = await this.autonomyEngine.runControlledAction(
        request,
        budget,
        context,
      );

      if (actionResult.success) {
        this.scheduler.completeSchedule(schedule.id);
        results.push({
          taskId,
          status: "SUCCESS",
          attempts: budget.usedActions,
        });
      } else if (actionResult.state === "APPROVAL_REQUIRED") {
        results.push({
          taskId,
          status: "APPROVAL_REQUIRED",
          attempts: budget.usedActions,
          details: actionResult.error,
        });
      } else if (actionResult.state === "BLOCKED") {
        this.scheduler.cancelSchedule(schedule.id);
        results.push({
          taskId,
          status: "BLOCKED",
          attempts: budget.usedActions,
          details: actionResult.error,
        });
      } else {
        results.push({
          taskId,
          status: "FAILED_MAX_RETRIES",
          attempts: budget.usedActions,
          details: actionResult.error,
        });
      }
    }

    return results;
  }
}
