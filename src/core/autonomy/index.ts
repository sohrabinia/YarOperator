import { PolicyEngine } from "../policy/index.js";
import { ApprovalManager } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { AgentOrchestrator, ExecutionScope } from "../orchestrator/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { AcceptanceEngine, AcceptanceCriteria } from "../acceptance/index.js";
import {
  ExecutionContext,
  ActionSafetyLevel,
  ToolResult,
} from "../contracts/index.js";

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

export interface AutonomyBudget {
  maxActions: number;
  maxRetries: number;
  maxReplans: number;
  usedActions: number;
  usedRetries: number;
  usedReplans: number;
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

  async evaluateAutonomyDecision(
    request: AutonomousActionRequest,
    scope: ExecutionScope,
    context: ExecutionContext,
  ): Promise<AutonomyDecision> {
    const now = new Date();

    // 1. Missing scope or workspace mismatch -> BLOCKED (Fail closed)
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

    // 2. Protected Security Infrastructure Self-Modification Protection
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

    // 3. Tool Authorization Check in ExecutionScope
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

    // 4. PolicyEngine Evaluation (Authoritative Security Gate)
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

    // Delegate evaluation directly to PolicyEngine (which handles single-use token consumption)
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
    error?: string;
  }> {
    let currentState: AutonomyLifecycleState = "CREATED";

    // Check Budget Limits
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

    // Transition CREATED -> PLANNED
    if (this.validateStateTransition(currentState, "PLANNED")) {
      currentState = "PLANNED";
    }

    // Resolve Agent & Execution Scope
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

    // Transition PLANNED -> EVALUATING
    if (this.validateStateTransition(currentState, "EVALUATING")) {
      currentState = "EVALUATING";
    }

    // Evaluate Autonomy Decision
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

    // State is SAFE
    if (this.validateStateTransition(currentState, "SAFE")) {
      currentState = "SAFE";
    }

    // Revalidate Runtime Authorization before execution: SAFE -> EXECUTING
    if (!this.validateStateTransition(currentState, "EXECUTING")) {
      return {
        success: false,
        state: "FAILED",
        decision,
        error: `Invalid state transition from '${currentState}' to 'EXECUTING'.`,
      };
    }

    currentState = "EXECUTING";

    // ACTUALLY EXECUTE TOOL VIA SECURE TOOL ECOSYSTEM
    const executionResult = await this.toolEcosystem.execute(
      request.toolId,
      request.params,
      scope,
      context,
    );

    if (!executionResult.success) {
      if (budget.usedRetries < budget.maxRetries) {
        budget.usedRetries++;
        currentState = "RETRYING";
        await this.auditManager.recordEvent(
          "ACTION_FAILED",
          {
            error: `Tool execution failed: ${executionResult.error}. Retrying (${budget.usedRetries}/${budget.maxRetries})...`,
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
        const err = `Tool execution failed after retries: ${executionResult.error}`;
        const esc = await this.escalate(request, currentState, err);
        return {
          success: false,
          state: "FAILED",
          decision,
          escalation: esc,
          error: err,
        };
      }
    }

    // Transition EXECUTING -> VALIDATING
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
      if (budget.usedRetries < budget.maxRetries) {
        budget.usedRetries++;
        currentState = "RETRYING";
        await this.auditManager.recordEvent(
          "ACTION_FAILED",
          {
            error: `Acceptance check failed: ${acceptanceReasons.join("; ")}. Retrying...`,
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
        const esc = await this.escalate(request, currentState, err);
        return {
          success: false,
          state: "FAILED",
          decision,
          escalation: esc,
          error: err,
        };
      }
    }

    // Transition VALIDATING -> COMPLETED
    if (this.validateStateTransition(currentState, "COMPLETED")) {
      currentState = "COMPLETED";
    }

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
