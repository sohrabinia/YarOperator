import { PolicyEngine } from "../policy/index.js";
import { ApprovalManager } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { AgentOrchestrator, ExecutionScope } from "../orchestrator/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { AcceptanceEngine, AcceptanceCriteria } from "../acceptance/index.js";
import { DurableOperationalMemory } from "../memory/index.js";
import { EnvironmentManager } from "../environment/index.js";
import { ExecutionContext, ActionSafetyLevel } from "../contracts/index.js";

export type AutonomyDecisionLevel = "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";

export type AutonomyLifecycleState =
  | "CREATED"
  | "PLANNED"
  | "EVALUATING"
  | "SAFE"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "EXECUTING"
  | "VALIDATING"
  | "RETRYING"
  | "ESCALATED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type FailureClassification = "RETRYABLE" | "NON_RETRYABLE" | "INTERNAL";

export interface AutonomyBudget {
  maxActions: number;
  maxRetries: number;
  maxReplans: number;
  usedActions: number;
  usedRetries: number;
  usedReplans: number;
}

export interface DurableRetryState {
  [key: string]: unknown;
  taskId: string;
  workspaceId: string;
  attemptNumber: number;
  maxRetries: number;
  failureClassification: FailureClassification;
  failureReason: string;
  nextRetryAtIso: string;
  status: "RETRYING" | "EXHAUSTED" | "COMPLETED" | "CANCELLED";
  updatedAtIso: string;
}

export interface AutonomyDecision {
  decision: AutonomyDecisionLevel;
  reason: string;
  policyResult: ActionSafetyLevel | "UNCLASSIFIED";
  approvalRequired: boolean;
  approvalFingerprint?: string;
  scopeValid: boolean;
  toolAuthorized: boolean;
  workspaceId: string;
  environmentId?: string;
  actionToolId: string;
  timestamp: Date;
}

export interface AutonomousActionRequest {
  taskId: string;
  workspaceId: string;
  environmentId?: string;
  repository?: string;
  toolId: string;
  params: unknown;
  capability?: string;
  acceptanceCriteria?: AcceptanceCriteria;
  actualRoutes?: string[];
  isSecurityCriticalModification?: boolean;
}

export interface EscalationRecord {
  taskId: string;
  workspaceId: string;
  reason: string;
  attemptedToolId: string;
  authorizationResult: AutonomyDecision;
  evidence?: Record<string, unknown>;
  timestamp: Date;
}

const PROTECTED_SECURITY_MODULES = [
  "policyengine",
  "approvalmanager",
  "securetoolecosystem",
  "executionscope",
  "credential",
  "workspaceisolation",
  "environmentauthorization",
  "autonomysafetyboundary",
];

export class ControlledAutonomyEngine {
  private allowedStateTransitions = new Map<
    AutonomyLifecycleState,
    Set<AutonomyLifecycleState>
  >([
    [
      "CREATED",
      new Set<AutonomyLifecycleState>([
        "PLANNED",
        "EVALUATING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
      ]),
    ],
    [
      "PLANNED",
      new Set<AutonomyLifecycleState>([
        "EVALUATING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "SAFE",
      ]),
    ],
    [
      "EVALUATING",
      new Set<AutonomyLifecycleState>([
        "SAFE",
        "APPROVAL_REQUIRED",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
      ]),
    ],
    [
      "SAFE",
      new Set<AutonomyLifecycleState>([
        "EXECUTING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "EVALUATING",
      ]),
    ],
    [
      "APPROVAL_REQUIRED",
      new Set<AutonomyLifecycleState>([
        "APPROVED",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
      ]),
    ],
    [
      "APPROVED",
      new Set<AutonomyLifecycleState>([
        "EXECUTING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "EVALUATING",
      ]),
    ],
    [
      "EXECUTING",
      new Set<AutonomyLifecycleState>([
        "VALIDATING",
        "RETRYING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "COMPLETED",
      ]),
    ],
    [
      "VALIDATING",
      new Set<AutonomyLifecycleState>([
        "COMPLETED",
        "RETRYING",
        "FAILED",
        "ESCALATED",
        "BLOCKED",
      ]),
    ],
    [
      "RETRYING",
      new Set<AutonomyLifecycleState>([
        "EVALUATING",
        "EXECUTING",
        "FAILED",
        "ESCALATED",
        "BLOCKED",
      ]),
    ],
    ["ESCALATED", new Set<AutonomyLifecycleState>(["FAILED", "EVALUATING"])],
    ["BLOCKED", new Set<AutonomyLifecycleState>(["FAILED"])],
    ["COMPLETED", new Set<AutonomyLifecycleState>([])],
    ["FAILED", new Set<AutonomyLifecycleState>([])],
  ]);

  constructor(
    private orchestrator: AgentOrchestrator,
    private policyEngine: PolicyEngine,
    private approvalManager: ApprovalManager,
    private toolEcosystem: SecureToolEcosystem,
    private acceptanceEngine: AcceptanceEngine,
    private auditManager: AuditManager,
    private notificationManager: NotificationManager,
    private memory: DurableOperationalMemory = new DurableOperationalMemory(),
    private environmentManager: EnvironmentManager = new EnvironmentManager(),
  ) {}

  validateStateTransition(
    current: AutonomyLifecycleState,
    target: AutonomyLifecycleState,
  ): boolean {
    const validTargets = this.allowedStateTransitions.get(current);
    if (!validTargets || !validTargets.has(target)) {
      return false;
    }
    return true;
  }

  classifyFailure(reason: string): FailureClassification {
    const lower = (reason || "").toLowerCase();
    if (
      lower.includes("security") ||
      lower.includes("blocked") ||
      lower.includes("unauthorized") ||
      lower.includes("permission")
    ) {
      return "NON_RETRYABLE";
    }
    if (
      lower.includes("crash") ||
      lower.includes("bug") ||
      lower.includes("internal") ||
      lower.includes("fatal")
    ) {
      return "INTERNAL";
    }
    return "RETRYABLE";
  }

  getRetryState(taskId: string): DurableRetryState | null {
    const entry = this.memory.getState<DurableRetryState>(
      `task_retry:${taskId}`,
    );
    return entry ? entry.value : null;
  }

  recoverInterruptedTasks(atTime: Date = new Date()): {
    recoveredCount: number;
    resumedTasks: string[];
    failedRecoveryTasks: string[];
  } {
    const keys = this.memory.listKeys("task_retry:");
    const resumedTasks: string[] = [];
    const failedRecoveryTasks: string[] = [];
    const nowIso = atTime.toISOString();

    for (const key of keys) {
      const entry = this.memory.getState<DurableRetryState>(key);
      if (entry && entry.value && entry.value.status === "RETRYING") {
        const rState = entry.value;

        // Verify required durable context for safe reconstruction
        if (
          !rState.taskId ||
          !rState.workspaceId ||
          typeof rState.attemptNumber !== "number" ||
          typeof rState.maxRetries !== "number"
        ) {
          rState.status = "CANCELLED";
          rState.updatedAtIso = nowIso;
          this.memory.saveState(key, rState);

          this.auditManager.recordEvent(
            "ACTION_FAILED",
            {
              error: `Crash recovery blocked: Task '${rState.taskId || key}' lacks required durable context for safe reconstruction.`,
              retryState: rState,
            },
            {
              workspaceId: rState.workspaceId || "UNKNOWN",
              taskId: rState.taskId || "UNKNOWN",
              severity: "CRITICAL",
            },
          );
          failedRecoveryTasks.push(rState.taskId || key);
          continue;
        }

        // Revalidate environment boundary and health before resuming
        const targetEnvId =
          (rState.environmentId as string) || `env_${rState.workspaceId}`;

        const envCheck = this.environmentManager.validateEnvironmentAccess(
          targetEnvId,
          rState.workspaceId,
        );

        if (!envCheck.valid) {
          rState.status = "CANCELLED";
          rState.updatedAtIso = nowIso;
          this.memory.saveState(key, rState);

          this.auditManager.recordEvent(
            "ACTION_FAILED",
            {
              error: `Crash recovery blocked for task '${rState.taskId}': Environment validation failed (${envCheck.reason}).`,
              retryState: rState,
            },
            {
              workspaceId: rState.workspaceId,
              taskId: rState.taskId,
              severity: "CRITICAL",
            },
          );
          failedRecoveryTasks.push(rState.taskId);
          continue;
        }

        // Revalidate policy rules if tool ID is present
        if (rState.toolId && typeof rState.toolId === "string") {
          const rule = this.policyEngine.getRule(rState.toolId);
          if (rule === "BLOCKED") {
            rState.status = "CANCELLED";
            rState.updatedAtIso = nowIso;
            this.memory.saveState(key, rState);

            this.auditManager.recordEvent(
              "ACTION_FAILED",
              {
                error: `Crash recovery blocked for task '${rState.taskId}': Tool '${rState.toolId}' is explicitly BLOCKED by policy.`,
                retryState: rState,
              },
              {
                workspaceId: rState.workspaceId,
                taskId: rState.taskId,
                severity: "CRITICAL",
              },
            );
            failedRecoveryTasks.push(rState.taskId);
            continue;
          }
        }

        if (rState.nextRetryAtIso <= nowIso) {
          resumedTasks.push(rState.taskId);
        }
      }
    }

    return {
      recoveredCount: resumedTasks.length,
      resumedTasks,
      failedRecoveryTasks,
    };
  }

  async evaluateAutonomyDecision(
    request: AutonomousActionRequest,
    scope: ExecutionScope,
    context: ExecutionContext,
  ): Promise<AutonomyDecision> {
    const now = new Date();

    if (
      !request.workspaceId ||
      !request.toolId ||
      scope.workspaceId !== request.workspaceId
    ) {
      return {
        decision: "BLOCKED",
        reason:
          "Missing execution scope, invalid workspace context, or workspace mismatch.",
        policyResult: "UNCLASSIFIED",
        approvalRequired: false,
        scopeValid: false,
        toolAuthorized: false,
        workspaceId: request.workspaceId || "UNKNOWN",
        environmentId: request.environmentId,
        actionToolId: request.toolId || "UNKNOWN",
        timestamp: now,
      };
    }

    // Mandatory Environment Boundary Validation
    const effectiveEnvId =
      request.environmentId || `env_${request.workspaceId}`;

    const envCheck = this.environmentManager.validateEnvironmentAccess(
      effectiveEnvId,
      request.workspaceId,
      request.toolId,
    );

    if (!envCheck.valid) {
      return {
        decision: "BLOCKED",
        reason:
          envCheck.reason ||
          `Mandatory environment boundary validation failed for environment '${effectiveEnvId}'.`,
        policyResult: "BLOCKED",
        approvalRequired: false,
        scopeValid: false,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: effectiveEnvId,
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    if (request.isSecurityCriticalModification) {
      return {
        decision: "BLOCKED",
        reason:
          "Autonomous self-modification of security infrastructure or policy boundary is explicitly BLOCKED.",
        policyResult: "BLOCKED",
        approvalRequired: false,
        scopeValid: true,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    const toolLower = request.toolId.toLowerCase();
    for (const protectedMod of PROTECTED_SECURITY_MODULES) {
      if (
        toolLower.includes(protectedMod) &&
        (toolLower.includes("modify") ||
          toolLower.includes("update") ||
          toolLower.includes("bypass") ||
          toolLower.includes("override"))
      ) {
        return {
          decision: "BLOCKED",
          reason: `Attempt to modify security boundary '${protectedMod}' is explicitly BLOCKED.`,
          policyResult: "BLOCKED",
          approvalRequired: false,
          scopeValid: true,
          toolAuthorized: false,
          workspaceId: request.workspaceId,
          environmentId: request.environmentId,
          actionToolId: request.toolId,
          timestamp: now,
        };
      }
    }

    const isAuthorizedTool = this.toolEcosystem.isToolAuthorized(
      request.toolId,
      scope,
    );

    if (!isAuthorizedTool) {
      return {
        decision: "BLOCKED",
        reason: `Tool '${request.toolId}' is not authorized in current ExecutionScope.`,
        policyResult: "UNCLASSIFIED",
        approvalRequired: false,
        scopeValid: true,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    const fingerprint = this.approvalManager.createFingerprint(
      request.toolId,
      request.params,
    );

    const rule = this.policyEngine.getRule(request.toolId);

    if (rule === "BLOCKED") {
      return {
        decision: "BLOCKED",
        reason: `Tool '${request.toolId}' is explicitly BLOCKED by PolicyEngine.`,
        policyResult: "BLOCKED",
        approvalRequired: false,
        scopeValid: true,
        toolAuthorized: true,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    if (rule === "APPROVAL_REQUIRED") {
      const approvalReq = this.approvalManager.get(fingerprint);
      if (!approvalReq || approvalReq.status !== "APPROVED") {
        return {
          decision: "APPROVAL_REQUIRED",
          reason: `Tool '${request.toolId}' requires explicit owner approval.`,
          policyResult: "APPROVAL_REQUIRED",
          approvalRequired: true,
          approvalFingerprint: fingerprint,
          scopeValid: true,
          toolAuthorized: true,
          workspaceId: request.workspaceId,
          environmentId: request.environmentId,
          actionToolId: request.toolId,
          timestamp: now,
        };
      }
    }

    const policyEval = await this.policyEngine.evaluate({
      toolId: request.toolId,
      params: request.params,
      context,
    });

    if (!policyEval.allowed) {
      return {
        decision: "BLOCKED",
        reason:
          policyEval.reason ||
          `Tool '${request.toolId}' blocked by PolicyEngine.`,
        policyResult: (rule || "UNCLASSIFIED") as
          ActionSafetyLevel | "UNCLASSIFIED",
        approvalRequired: rule === "APPROVAL_REQUIRED",
        approvalFingerprint:
          rule === "APPROVAL_REQUIRED" ? fingerprint : undefined,
        scopeValid: true,
        toolAuthorized: true,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    return {
      decision: "SAFE",
      reason: `Tool '${request.toolId}' is authorized by PolicyEngine.`,
      policyResult: (rule || "SAFE") as ActionSafetyLevel | "UNCLASSIFIED",
      approvalRequired: false,
      scopeValid: true,
      toolAuthorized: true,
      workspaceId: request.workspaceId,
      environmentId: request.environmentId,
      actionToolId: request.toolId,
      timestamp: now,
    };
  }

  async runControlledAction(
    request: AutonomousActionRequest,
    budget: AutonomyBudget,
    context: ExecutionContext,
  ): Promise<{
    success: boolean;
    state: AutonomyLifecycleState;
    decision: AutonomyDecision;
    escalation?: EscalationRecord;
    evidence?: Record<string, unknown>;
    retryState?: DurableRetryState;
    error?: string;
  }> {
    let currentState: AutonomyLifecycleState = "CREATED";

    if (budget.usedActions >= budget.maxActions) {
      const esc = await this.escalate(
        request,
        currentState,
        "Autonomy action budget exhausted.",
      );
      return {
        success: false,
        state: "ESCALATED",
        decision: {
          decision: "BLOCKED",
          reason: "Action budget exhausted.",
          policyResult: "UNCLASSIFIED",
          approvalRequired: false,
          scopeValid: false,
          toolAuthorized: false,
          workspaceId: request.workspaceId,
          actionToolId: request.toolId,
          timestamp: new Date(),
        },
        escalation: esc,
        error: "Action budget exhausted.",
      };
    }

    budget.usedActions++;

    if (this.validateStateTransition(currentState, "PLANNED")) {
      currentState = "PLANNED";
    }

    const capability = request.capability || "software-development";
    const selectedAgent = this.orchestrator.selectAgentForCapability(
      capability,
      request.workspaceId,
    );

    if (!selectedAgent) {
      const esc = await this.escalate(
        request,
        currentState,
        `No agent available with capability '${capability}' for workspace '${request.workspaceId}'.`,
      );
      return {
        success: false,
        state: "ESCALATED",
        decision: {
          decision: "BLOCKED",
          reason: "Agent selection failed.",
          policyResult: "UNCLASSIFIED",
          approvalRequired: false,
          scopeValid: false,
          toolAuthorized: false,
          workspaceId: request.workspaceId,
          actionToolId: request.toolId,
          timestamp: new Date(),
        },
        escalation: esc,
        error: "Agent selection failed.",
      };
    }

    const allowedToolsForScope = selectedAgent.toolScopes.includes(
      request.toolId,
    )
      ? [request.toolId]
      : [];

    const scope = this.orchestrator.createExecutionScope({
      workspaceId: request.workspaceId,
      agentId: selectedAgent.id,
      capabilities: [capability],
      tools: allowedToolsForScope,
    });

    if (this.validateStateTransition(currentState, "EVALUATING")) {
      currentState = "EVALUATING";
    }

    const decision = await this.evaluateAutonomyDecision(
      request,
      scope,
      context,
    );

    if (decision.decision === "BLOCKED") {
      currentState = "BLOCKED";
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { decision, request },
        {
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          severity: "HIGH",
        },
      );
      const esc = await this.escalate(request, currentState, decision.reason);
      return {
        success: false,
        state: "BLOCKED",
        decision,
        escalation: esc,
        error: decision.reason,
      };
    }

    if (decision.decision === "APPROVAL_REQUIRED") {
      currentState = "APPROVAL_REQUIRED";
      await this.auditManager.recordEvent(
        "DECISION_MADE",
        { decision, request },
        {
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          severity: "MEDIUM",
        },
      );

      this.notificationManager.notify({
        type: "APPROVAL_REQUIRED",
        title: "Autonomous Action Requires Approval",
        message: `Action '${request.toolId}' requires owner approval. Fingerprint: ${decision.approvalFingerprint}`,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
      });

      return {
        success: false,
        state: "APPROVAL_REQUIRED",
        decision,
        error: decision.reason,
      };
    }

    if (this.validateStateTransition(currentState, "SAFE")) {
      currentState = "SAFE";
    }

    if (!this.validateStateTransition(currentState, "EXECUTING")) {
      return {
        success: false,
        state: "FAILED",
        decision,
        error: `Invalid state transition from '${currentState}' to 'EXECUTING'.`,
      };
    }

    currentState = "EXECUTING";

    const executionResult = await this.toolEcosystem.execute(
      request.toolId,
      request.params,
      scope,
      context,
    );

    if (!executionResult.success) {
      const reason = executionResult.error || "Tool execution failed";
      const classification = this.classifyFailure(reason);

      if (
        budget.usedRetries < budget.maxRetries &&
        classification === "RETRYABLE"
      ) {
        budget.usedRetries++;
        currentState = "RETRYING";

        const backoffMs = Math.min(
          1000 * Math.pow(2, budget.usedRetries - 1),
          30000,
        );
        const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();

        const retryState: DurableRetryState = {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          attemptNumber: budget.usedRetries,
          maxRetries: budget.maxRetries,
          failureClassification: classification,
          failureReason: reason,
          nextRetryAtIso: nextRetryIso,
          status: "RETRYING",
          updatedAtIso: new Date().toISOString(),
        };

        this.memory.saveState(`task_retry:${request.taskId}`, retryState);

        await this.auditManager.recordEvent(
          "ACTION_FAILED",
          {
            error: `Tool execution failed: ${reason}. Durable retry recorded (${budget.usedRetries}/${budget.maxRetries}).`,
            retryState,
          },
          {
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            severity: "MEDIUM",
          },
        );

        return this.runControlledAction(request, budget, context);
      } else {
        currentState = "FAILED";
        const err = `Tool execution failed after retries: ${reason}`;

        const retryState: DurableRetryState = {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          attemptNumber: budget.usedRetries,
          maxRetries: budget.maxRetries,
          failureClassification: classification,
          failureReason: reason,
          nextRetryAtIso: new Date().toISOString(),
          status: "EXHAUSTED",
          updatedAtIso: new Date().toISOString(),
        };
        this.memory.saveState(`task_retry:${request.taskId}`, retryState);

        const esc = await this.escalate(request, currentState, err);
        return {
          success: false,
          state: "FAILED",
          decision,
          escalation: esc,
          retryState,
          error: err,
        };
      }
    }

    if (this.validateStateTransition(currentState, "VALIDATING")) {
      currentState = "VALIDATING";
    }

    let acceptancePassed = true;
    let acceptanceReasons: string[] = [];

    if (request.acceptanceCriteria) {
      const evalRes = this.acceptanceEngine.evaluate(
        request.acceptanceCriteria,
        executionResult.output,
      );
      acceptancePassed = evalRes.passed;
      acceptanceReasons = evalRes.reasons;
    }

    if (!acceptancePassed) {
      const reason = `Acceptance check failed: ${acceptanceReasons.join("; ")}`;
      const classification = this.classifyFailure(reason);

      if (
        budget.usedRetries < budget.maxRetries &&
        classification === "RETRYABLE"
      ) {
        budget.usedRetries++;
        currentState = "RETRYING";

        const backoffMs = Math.min(
          1000 * Math.pow(2, budget.usedRetries - 1),
          30000,
        );
        const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();

        const retryState: DurableRetryState = {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          attemptNumber: budget.usedRetries,
          maxRetries: budget.maxRetries,
          failureClassification: classification,
          failureReason: reason,
          nextRetryAtIso: nextRetryIso,
          status: "RETRYING",
          updatedAtIso: new Date().toISOString(),
        };

        this.memory.saveState(`task_retry:${request.taskId}`, retryState);

        await this.auditManager.recordEvent(
          "ACTION_FAILED",
          {
            error: `${reason}. Durable retry recorded (${budget.usedRetries}/${budget.maxRetries}).`,
            retryState,
          },
          {
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            severity: "MEDIUM",
          },
        );

        return this.runControlledAction(request, budget, context);
      } else {
        currentState = "FAILED";
        const err = `Acceptance failed after retries: ${acceptanceReasons.join("; ")}`;

        const retryState: DurableRetryState = {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          attemptNumber: budget.usedRetries,
          maxRetries: budget.maxRetries,
          failureClassification: classification,
          failureReason: reason,
          nextRetryAtIso: new Date().toISOString(),
          status: "EXHAUSTED",
          updatedAtIso: new Date().toISOString(),
        };
        this.memory.saveState(`task_retry:${request.taskId}`, retryState);

        const esc = await this.escalate(request, currentState, err);
        return {
          success: false,
          state: "FAILED",
          decision,
          escalation: esc,
          retryState,
          error: err,
        };
      }
    }

    if (this.validateStateTransition(currentState, "COMPLETED")) {
      currentState = "COMPLETED";
    }

    const completedRetryState: DurableRetryState = {
      taskId: request.taskId,
      workspaceId: request.workspaceId,
      attemptNumber: budget.usedRetries,
      maxRetries: budget.maxRetries,
      failureClassification: "RETRYABLE",
      failureReason: "",
      nextRetryAtIso: new Date().toISOString(),
      status: "COMPLETED",
      updatedAtIso: new Date().toISOString(),
    };
    this.memory.saveState(`task_retry:${request.taskId}`, completedRetryState);

    const evidence = {
      taskId: request.taskId,
      workspaceId: request.workspaceId,
      agentId: selectedAgent.id,
      provider: selectedAgent.provider,
      toolId: request.toolId,
      decision: decision.decision,
      toolResult: executionResult.output || executionResult,
      acceptancePassed: true,
      timestamp: new Date().toISOString(),
    };

    await this.auditManager.recordEvent(
      "ACTION_COMPLETED",
      { evidence, decision },
      {
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        severity: "LOW",
      },
    );

    this.notificationManager.notify({
      type: "TASK_COMPLETED",
      title: "Controlled Autonomous Action Completed",
      message: `Action '${request.toolId}' completed successfully under controlled autonomy.`,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
    });

    return {
      success: true,
      state: "COMPLETED",
      decision,
      evidence,
    };
  }

  private async escalate(
    request: AutonomousActionRequest,
    state: AutonomyLifecycleState,
    reason: string,
  ): Promise<EscalationRecord> {
    const escalation: EscalationRecord = {
      taskId: request.taskId,
      workspaceId: request.workspaceId,
      reason,
      attemptedToolId: request.toolId,
      authorizationResult: {
        decision: "BLOCKED",
        reason,
        policyResult: "UNCLASSIFIED",
        approvalRequired: false,
        scopeValid: true,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
        actionToolId: request.toolId,
        timestamp: new Date(),
      },
      timestamp: new Date(),
    };

    await this.auditManager.recordEvent(
      "ACTION_FAILED",
      { escalation, state },
      {
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        severity: "HIGH",
      },
    );

    this.notificationManager.notify({
      type: "TASK_FAILED",
      title: "Autonomous Action Escalated",
      message: `Action '${request.toolId}' escalated in state '${state}': ${reason}`,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
    });

    return escalation;
  }
}
