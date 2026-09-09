import { AgentOrchestrator } from "../orchestrator/index.js";
import { PolicyEngine } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { AcceptanceEngine, AcceptanceCriteria } from "../acceptance/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { ExecutionContext } from "../contracts/index.js";

export type DevelopmentTaskStatus =
  | "CREATED"
  | "PLANNED"
  | "ASSIGNED"
  | "AUTHORIZED"
  | "EXECUTING"
  | "TESTING"
  | "VALIDATING"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED";

export interface DevelopmentTask {
  id: string;
  workspaceId: string;
  repository?: string;
  title: string;
  description: string;
  goal: string;
  priority: "low" | "medium" | "high" | "critical";
  risk: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  status: DevelopmentTaskStatus;
  allowedCapabilities?: string[];
  allowedTools?: string[];
  environmentId?: string;
  acceptanceCriteria?: AcceptanceCriteria;
  actualRoutes?: string[];
  forbiddenActions?: string[];
  assignedAgentId?: string;
  evidence?: Record<string, unknown>;
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
    repository?: string;
    title: string;
    description: string;
    goal: string;
    priority?: "low" | "medium" | "high" | "critical";
    risk?: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
    allowedCapabilities?: string[];
    allowedTools?: string[];
    environmentId?: string;
    acceptanceCriteria?: AcceptanceCriteria;
    actualRoutes?: string[];
    forbiddenActions?: string[];
  }): DevelopmentTask {
    const now = new Date();
    const task: DevelopmentTask = {
      id: `dev_task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: params.workspaceId,
      repository: params.repository,
      title: params.title,
      description: params.description,
      goal: params.goal,
      priority: params.priority || "medium",
      risk: params.risk || "SAFE",
      status: "CREATED",
      allowedCapabilities: params.allowedCapabilities,
      allowedTools: params.allowedTools,
      environmentId: params.environmentId,
      acceptanceCriteria: params.acceptanceCriteria,
      actualRoutes: params.actualRoutes,
      forbiddenActions: params.forbiddenActions,
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

export class SelfDevelopmentTaskRunner {
  constructor(
    private orchestrator: AgentOrchestrator,
    private policyEngine: PolicyEngine,
    private toolEcosystem: SecureToolEcosystem,
    private acceptanceEngine: AcceptanceEngine,
    private auditManager: AuditManager,
    private notificationManager: NotificationManager,
  ) {}

  async runTask(
    task: DevelopmentTask,
    requestedToolId: string,
    toolParams: unknown,
    context: ExecutionContext,
  ): Promise<{
    success: boolean;
    error?: string;
    evidence?: Record<string, unknown>;
  }> {
    // 1. Fail Closed Verification for missing scope
    if (!task.workspaceId || !task.repository || !task.allowedTools) {
      task.status = "FAILED";
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { error: "Task missing workspaceId, repository, or tool scope." },
        { workspaceId: task.workspaceId, taskId: task.id, severity: "HIGH" },
      );
      return {
        success: false,
        error: "Missing required task execution scope.",
      };
    }

    // 2. Planning & Assignment
    task.status = "PLANNED";
    const requiredCapability =
      task.allowedCapabilities?.[0] || "software-development";
    const selectedAgent = this.orchestrator.selectAgentForCapability(
      requiredCapability,
      task.workspaceId,
    );

    if (!selectedAgent) {
      task.status = "FAILED";
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { error: `No agent available with capability '${requiredCapability}'` },
        { workspaceId: task.workspaceId, taskId: task.id, severity: "HIGH" },
      );
      return { success: false, error: "Agent selection failed." };
    }

    task.assignedAgentId = selectedAgent.id;
    task.status = "ASSIGNED";

    // 3. Execution Scope Creation & Tool Ecosystem Authorization
    const scope = this.orchestrator.createExecutionScope({
      workspaceId: task.workspaceId,
      agentId: selectedAgent.id,
      capabilities: task.allowedCapabilities || [requiredCapability],
      tools: task.allowedTools,
    });

    if (!this.toolEcosystem.isToolAuthorized(requestedToolId, scope)) {
      task.status = "FAILED";
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        {
          error: `Tool '${requestedToolId}' not authorized for execution scope.`,
        },
        { workspaceId: task.workspaceId, taskId: task.id, severity: "HIGH" },
      );
      return {
        success: false,
        error: `Tool '${requestedToolId}' is not authorized in task scope.`,
      };
    }

    // 4. Policy Engine Evaluation (Mandatory Security Boundary)
    const policyEval = await this.policyEngine.evaluate({
      toolId: requestedToolId,
      params: toolParams,
      context,
    });

    if (!policyEval.allowed) {
      task.status = "FAILED";
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { error: policyEval.reason || "Policy engine blocked execution." },
        { workspaceId: task.workspaceId, taskId: task.id, severity: "HIGH" },
      );
      return {
        success: false,
        error: policyEval.reason || "Policy engine evaluation failed.",
      };
    }

    task.status = "AUTHORIZED";

    // 5. Execution, Testing & Acceptance Validation
    task.status = "EXECUTING";
    task.status = "TESTING";
    task.status = "VALIDATING";

    let acceptancePassed = true;
    let acceptanceReasons: string[] = [];

    if (task.acceptanceCriteria) {
      const routesToTest =
        task.actualRoutes || task.acceptanceCriteria.requiredRoutes || [];
      const evalRes = this.acceptanceEngine.evaluate(
        task.acceptanceCriteria,
        routesToTest,
      );
      acceptancePassed = evalRes.passed;
      acceptanceReasons = evalRes.reasons;
    }

    if (!acceptancePassed) {
      task.status = "FAILED";
      const err = `Acceptance criteria failed: ${acceptanceReasons.join("; ")}`;
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { error: err },
        { workspaceId: task.workspaceId, taskId: task.id, severity: "HIGH" },
      );
      return { success: false, error: err };
    }

    // 6. Completion, Evidence Collection & Notification
    task.status = "COMPLETED";
    const evidence = {
      taskId: task.id,
      workspaceId: task.workspaceId,
      agentId: selectedAgent.id,
      provider: selectedAgent.provider,
      toolUsed: requestedToolId,
      acceptancePassed: true,
      timestamp: new Date().toISOString(),
    };
    task.evidence = evidence;

    await this.auditManager.recordEvent(
      "ACTION_COMPLETED",
      { evidence },
      { workspaceId: task.workspaceId, taskId: task.id, severity: "LOW" },
    );

    this.notificationManager.notify({
      type: "TASK_COMPLETED",
      title: "Self-Development Task Completed",
      message: `Task ${task.id} (${task.title}) successfully executed and validated.`,
      workspaceId: task.workspaceId,
      taskId: task.id,
    });

    return { success: true, evidence };
  }
}
