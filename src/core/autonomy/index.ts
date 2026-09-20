import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { AgentOrchestrator, ExecutionScope } from "../orchestrator/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { AcceptanceEngine, AcceptanceCriteria } from "../acceptance/index.js";
import { DurableOperationalMemory } from "../memory/index.js";
import { EnvironmentManager } from "../environment/index.js";
import { ExecutionContext, ActionSafetyLevel } from "../contracts/index.js";
import { IdentityStore } from "../identity/index.js";

export type AutonomyDecisionLevel = "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";

export type AutonomyLifecycleState =
  | "CREATED"
  | "AUTHORIZED"
  | "RUNNING"
  | "PLANNED"
  | "EVALUATING"
  | "SAFE"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_AI"
  | "PROPOSAL_RECEIVED"
  | "VALIDATING"
  | "EXECUTING"
  | "VERIFYING"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "RETRYING"
  | "ESCALATED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "LIMIT_REACHED"
  | "BLOCKED";

export const TERMINAL_AUTONOMY_STATES: ReadonlySet<AutonomyLifecycleState> =
  new Set([
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
    "LIMIT_REACHED",
    "BLOCKED",
  ]);

export type FailureClassification = "RETRYABLE" | "NON_RETRYABLE" | "INTERNAL";

export type AutonomyApprovalMode =
  "AUTO_SAFE" | "REQUIRE_APPROVAL" | "MANUAL_ONLY";

export interface AutonomyPolicy {
  maxIterations: number;
  maxRuntimeMs: number;
  maxDelegations: number;
  maxActions: number;
  maxRetries: number;
  maxResponseSize?: number;
  allowedCapabilities: string[];
  approvalMode: AutonomyApprovalMode;
}

export interface BoundedAutonomyRunConfig {
  runId: string;
  ownerId: string;
  workspaceId: string;
  taskId: string;
  environmentId: string;
  policy: AutonomyPolicy;
  initialInput?: Record<string, unknown> | string;
}

export interface AIProposal {
  runId: string;
  taskId: string;
  workspaceId: string;
  requestedCapability: string;
  proposedAction: string;
  params: Record<string, unknown>;
  expectedResult?: string;
  rationale?: string;
  isTerminalProposal?: boolean;
}

export interface AutonomousRunRecord {
  runId: string;
  ownerId: string;
  workspaceId: string;
  taskId: string;
  environmentId: string;
  status: AutonomyLifecycleState;
  policy: AutonomyPolicy;
  iterationsCount: number;
  delegationsCount: number;
  actionsCount: number;
  retriesCount: number;
  terminalReason?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  lastProposal?: AIProposal;
  lastVerificationResult?: "SUCCESS" | "FAILED" | "INCONCLUSIVE";
  auditTrail: Array<{
    state: AutonomyLifecycleState;
    timestamp: Date;
    details?: Record<string, unknown>;
  }>;
}

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
  "identitystore",
  "autonomypolicy",
];

export class ControlledAutonomyEngine {
  private runs = new Map<string, AutonomousRunRecord>();
  private activeTaskRuns = new Map<string, string>(); // taskId -> runId

  private allowedStateTransitions = new Map<
    AutonomyLifecycleState,
    Set<AutonomyLifecycleState>
  >([
    [
      "CREATED",
      new Set<AutonomyLifecycleState>([
        "AUTHORIZED",
        "PLANNED",
        "EVALUATING",
        "WAITING_FOR_AI",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "ESCALATED",
      ]),
    ],
    [
      "AUTHORIZED",
      new Set<AutonomyLifecycleState>([
        "RUNNING",
        "WAITING_FOR_AI",
        "PLANNED",
        "EVALUATING",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "RUNNING",
      new Set<AutonomyLifecycleState>([
        "WAITING_FOR_AI",
        "PROPOSAL_RECEIVED",
        "VALIDATING",
        "EXECUTING",
        "WAITING_FOR_APPROVAL",
        "EVALUATING",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "LIMIT_REACHED",
        "COMPLETED",
      ]),
    ],
    [
      "WAITING_FOR_AI",
      new Set<AutonomyLifecycleState>([
        "PROPOSAL_RECEIVED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "BLOCKED",
      ]),
    ],
    [
      "PROPOSAL_RECEIVED",
      new Set<AutonomyLifecycleState>([
        "VALIDATING",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "VALIDATING",
      new Set<AutonomyLifecycleState>([
        "SAFE",
        "APPROVAL_REQUIRED",
        "WAITING_FOR_APPROVAL",
        "EXECUTING",
        "VERIFYING",
        "RETRYING",
        "COMPLETED",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
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
        "RUNNING",
      ]),
    ],
    [
      "EVALUATING",
      new Set<AutonomyLifecycleState>([
        "SAFE",
        "APPROVAL_REQUIRED",
        "WAITING_FOR_APPROVAL",
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
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "WAITING_FOR_APPROVAL",
      new Set<AutonomyLifecycleState>([
        "APPROVED",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "APPROVAL_REQUIRED",
      new Set<AutonomyLifecycleState>([
        "APPROVED",
        "WAITING_FOR_APPROVAL",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "CANCELLED",
        "TIMED_OUT",
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
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "EXECUTING",
      new Set<AutonomyLifecycleState>([
        "VERIFYING",
        "VALIDATING",
        "RETRYING",
        "BLOCKED",
        "FAILED",
        "ESCALATED",
        "COMPLETED",
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "VERIFYING",
      new Set<AutonomyLifecycleState>([
        "RUNNING",
        "COMPLETED",
        "RETRYING",
        "FAILED",
        "LIMIT_REACHED",
        "BLOCKED",
        "CANCELLED",
        "TIMED_OUT",
      ]),
    ],
    [
      "RETRYING",
      new Set<AutonomyLifecycleState>([
        "RUNNING",
        "EVALUATING",
        "EXECUTING",
        "FAILED",
        "ESCALATED",
        "BLOCKED",
        "CANCELLED",
        "TIMED_OUT",
        "LIMIT_REACHED",
      ]),
    ],
    ["ESCALATED", new Set<AutonomyLifecycleState>(["FAILED", "EVALUATING"])],
    ["BLOCKED", new Set<AutonomyLifecycleState>([])],
    ["COMPLETED", new Set<AutonomyLifecycleState>([])],
    ["FAILED", new Set<AutonomyLifecycleState>([])],
    ["CANCELLED", new Set<AutonomyLifecycleState>([])],
    ["TIMED_OUT", new Set<AutonomyLifecycleState>([])],
    ["LIMIT_REACHED", new Set<AutonomyLifecycleState>([])],
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
    private identityStore?: IdentityStore,
  ) {}

  public validateStateTransition(
    current: AutonomyLifecycleState,
    target: AutonomyLifecycleState,
  ): boolean {
    if (TERMINAL_AUTONOMY_STATES.has(current)) {
      return false; // Terminal states are strictly immutable
    }
    const validTargets = this.allowedStateTransitions.get(current);
    if (!validTargets || !validTargets.has(target)) {
      return false;
    }
    return true;
  }

  public validatePolicy(policy: AutonomyPolicy): {
    valid: boolean;
    reason?: string;
  } {
    if (!policy || typeof policy !== "object") {
      return { valid: false, reason: "Autonomy policy is missing or null." };
    }
    if (typeof policy.maxIterations !== "number" || policy.maxIterations <= 0) {
      return {
        valid: false,
        reason: "maxIterations must be a positive integer.",
      };
    }
    if (typeof policy.maxRuntimeMs !== "number" || policy.maxRuntimeMs <= 0) {
      return {
        valid: false,
        reason: "maxRuntimeMs must be a positive integer.",
      };
    }
    if (
      typeof policy.maxDelegations !== "number" ||
      policy.maxDelegations < 0
    ) {
      return {
        valid: false,
        reason: "maxDelegations must be a non-negative integer.",
      };
    }
    if (typeof policy.maxActions !== "number" || policy.maxActions < 0) {
      return {
        valid: false,
        reason: "maxActions must be a non-negative integer.",
      };
    }
    if (typeof policy.maxRetries !== "number" || policy.maxRetries < 0) {
      return {
        valid: false,
        reason: "maxRetries must be a non-negative integer.",
      };
    }
    if (!Array.isArray(policy.allowedCapabilities)) {
      return {
        valid: false,
        reason:
          "allowedCapabilities must be an array of string capability IDs.",
      };
    }
    if (
      !policy.approvalMode ||
      !["AUTO_SAFE", "REQUIRE_APPROVAL", "MANUAL_ONLY"].includes(
        policy.approvalMode,
      )
    ) {
      return {
        valid: false,
        reason:
          "approvalMode must be 'AUTO_SAFE', 'REQUIRE_APPROVAL', or 'MANUAL_ONLY'.",
      };
    }
    return { valid: true };
  }

  public async startRun(
    config: BoundedAutonomyRunConfig,
  ): Promise<AutonomousRunRecord> {
    const now = new Date();

    // 1. Check required identity fields
    if (
      !config.runId ||
      !config.ownerId ||
      !config.workspaceId ||
      !config.taskId ||
      !config.environmentId
    ) {
      const rec: AutonomousRunRecord = {
        runId: config.runId || `run_${Date.now()}`,
        ownerId: config.ownerId || "",
        workspaceId: config.workspaceId || "",
        taskId: config.taskId || "",
        environmentId: config.environmentId || "",
        status: "BLOCKED",
        policy: config.policy,
        iterationsCount: 0,
        delegationsCount: 0,
        actionsCount: 0,
        retriesCount: 0,
        terminalReason:
          "Missing required runId, ownerId, workspaceId, taskId, or environmentId context.",
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        auditTrail: [
          {
            state: "BLOCKED",
            timestamp: now,
            details: {
              reason:
                "Missing required runId, ownerId, workspaceId, taskId, or environmentId context.",
            },
          },
        ],
      };
      return rec;
    }

    // Singleton check: prevent duplicate active execution for same task
    const existingRunId = this.activeTaskRuns.get(config.taskId);
    if (existingRunId) {
      const existingRun = this.runs.get(existingRunId);
      if (existingRun && !TERMINAL_AUTONOMY_STATES.has(existingRun.status)) {
        const rec: AutonomousRunRecord = {
          runId: config.runId,
          ownerId: config.ownerId,
          workspaceId: config.workspaceId,
          taskId: config.taskId,
          environmentId: config.environmentId,
          status: "BLOCKED",
          policy: config.policy,
          iterationsCount: 0,
          delegationsCount: 0,
          actionsCount: 0,
          retriesCount: 0,
          terminalReason: `Duplicate active execution rejected: Task '${config.taskId}' already has active run '${existingRunId}'.`,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          auditTrail: [
            {
              state: "BLOCKED",
              timestamp: now,
              details: {
                reason: `Duplicate active execution rejected: Task '${config.taskId}' already has active run '${existingRunId}'.`,
              },
            },
          ],
        };
        return rec;
      }
    }

    // 2. Validate Policy
    const polCheck = this.validatePolicy(config.policy);
    if (!polCheck.valid) {
      const rec: AutonomousRunRecord = {
        runId: config.runId,
        ownerId: config.ownerId,
        workspaceId: config.workspaceId,
        taskId: config.taskId,
        environmentId: config.environmentId,
        status: "BLOCKED",
        policy: config.policy,
        iterationsCount: 0,
        delegationsCount: 0,
        actionsCount: 0,
        retriesCount: 0,
        terminalReason: `Invalid policy: ${polCheck.reason}`,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        auditTrail: [
          {
            state: "BLOCKED",
            timestamp: now,
            details: { reason: `Invalid policy: ${polCheck.reason}` },
          },
        ],
      };
      return rec;
    }

    // 3. Verify owner & workspace active membership if IdentityStore available
    if (this.identityStore) {
      const owner = this.identityStore.getUserById(config.ownerId);
      if (!owner || owner.status !== "ACTIVE") {
        const rec: AutonomousRunRecord = {
          runId: config.runId,
          ownerId: config.ownerId,
          workspaceId: config.workspaceId,
          taskId: config.taskId,
          environmentId: config.environmentId,
          status: "BLOCKED",
          policy: config.policy,
          iterationsCount: 0,
          delegationsCount: 0,
          actionsCount: 0,
          retriesCount: 0,
          terminalReason: `Owner '${config.ownerId}' does not exist or is disabled.`,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          auditTrail: [
            {
              state: "BLOCKED",
              timestamp: now,
              details: {
                reason: `Owner '${config.ownerId}' does not exist or is disabled.`,
              },
            },
          ],
        };
        return rec;
      }

      const isMember = this.identityStore.isUserActiveWorkspaceMember(
        config.ownerId,
        config.workspaceId,
      );
      if (!isMember) {
        const rec: AutonomousRunRecord = {
          runId: config.runId,
          ownerId: config.ownerId,
          workspaceId: config.workspaceId,
          taskId: config.taskId,
          environmentId: config.environmentId,
          status: "BLOCKED",
          policy: config.policy,
          iterationsCount: 0,
          delegationsCount: 0,
          actionsCount: 0,
          retriesCount: 0,
          terminalReason: `Owner '${config.ownerId}' is not an active member of workspace '${config.workspaceId}'.`,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          auditTrail: [
            {
              state: "BLOCKED",
              timestamp: now,
              details: {
                reason: `Owner '${config.ownerId}' is not an active member of workspace '${config.workspaceId}'.`,
              },
            },
          ],
        };
        return rec;
      }
    }

    // 4. Validate Environment
    const envCheck = this.environmentManager.validateEnvironmentAccess(
      config.environmentId,
      config.workspaceId,
    );
    if (!envCheck.valid) {
      const rec: AutonomousRunRecord = {
        runId: config.runId,
        ownerId: config.ownerId,
        workspaceId: config.workspaceId,
        taskId: config.taskId,
        environmentId: config.environmentId,
        status: "BLOCKED",
        policy: config.policy,
        iterationsCount: 0,
        delegationsCount: 0,
        actionsCount: 0,
        retriesCount: 0,
        terminalReason:
          envCheck.reason ||
          `Environment validation failed for '${config.environmentId}'.`,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        auditTrail: [
          {
            state: "BLOCKED",
            timestamp: now,
            details: {
              reason:
                envCheck.reason ||
                `Environment validation failed for '${config.environmentId}'.`,
            },
          },
        ],
      };
      return rec;
    }

    const run: AutonomousRunRecord = {
      runId: config.runId,
      ownerId: config.ownerId,
      workspaceId: config.workspaceId,
      taskId: config.taskId,
      environmentId: config.environmentId,
      status: "CREATED",
      policy: config.policy,
      iterationsCount: 0,
      delegationsCount: 0,
      actionsCount: 0,
      retriesCount: 0,
      createdAt: now,
      updatedAt: now,
      auditTrail: [{ state: "CREATED", timestamp: now }],
    };

    this.runs.set(run.runId, run);
    this.activeTaskRuns.set(config.taskId, config.runId);

    this.transitionRunState(run, "AUTHORIZED");

    await this.auditManager.recordEvent(
      "TASK_CREATED",
      { runId: run.runId, policy: run.policy },
      { workspaceId: run.workspaceId, taskId: run.taskId },
    );

    return run;
  }

  public getRun(runId: string): AutonomousRunRecord | undefined {
    return this.runs.get(runId);
  }

  public validateAIProposal(
    run: AutonomousRunRecord,
    proposal: AIProposal,
  ): { valid: boolean; reason?: string } {
    if (!proposal || typeof proposal !== "object") {
      return { valid: false, reason: "AI proposal is missing or null." };
    }
    if (proposal.runId !== run.runId) {
      return {
        valid: false,
        reason: `Proposal runId '${proposal.runId}' does not match active runId '${run.runId}'.`,
      };
    }
    if (proposal.taskId !== run.taskId) {
      return {
        valid: false,
        reason: `Proposal taskId '${proposal.taskId}' does not match active taskId '${run.taskId}'.`,
      };
    }
    if (proposal.workspaceId !== run.workspaceId) {
      return {
        valid: false,
        reason: `Proposal workspaceId '${proposal.workspaceId}' does not match run workspaceId '${run.workspaceId}'.`,
      };
    }
    if (!proposal.requestedCapability) {
      return {
        valid: false,
        reason: "Missing requestedCapability in AI proposal.",
      };
    }
    if (!proposal.proposedAction) {
      return { valid: false, reason: "Missing proposedAction in AI proposal." };
    }

    // Check allowed capabilities in run policy
    if (
      !run.policy.allowedCapabilities.includes(proposal.requestedCapability)
    ) {
      return {
        valid: false,
        reason: `Capability '${proposal.requestedCapability}' is not in allowedCapabilities list.`,
      };
    }

    // Security check: reject privilege injection or policy modification attempts
    const actionLower = proposal.proposedAction.toLowerCase();
    for (const protMod of PROTECTED_SECURITY_MODULES) {
      if (
        actionLower.includes(protMod) &&
        (actionLower.includes("modify") ||
          actionLower.includes("update") ||
          actionLower.includes("grant") ||
          actionLower.includes("bypass") ||
          actionLower.includes("override"))
      ) {
        return {
          valid: false,
          reason: `Attempt to modify security boundary '${protMod}' in proposal is explicitly REJECTED.`,
        };
      }
    }

    const paramsStr = JSON.stringify(proposal.params || {});
    if (
      /(SUDO|GRANT_PERMISSION|CREATE_CREDENTIAL|MODIFY_AUTHORIZATION|EXECUTE_PRODUCTION_TRADING)/i.test(
        paramsStr,
      )
    ) {
      return {
        valid: false,
        reason:
          "Proposal parameters contain forbidden privileged injection triggers.",
      };
    }

    return { valid: true };
  }

  public verifyExecutionResult(
    run: AutonomousRunRecord,
    rawOutput: unknown,
  ): "SUCCESS" | "FAILED" | "INCONCLUSIVE" {
    if (rawOutput === undefined || rawOutput === null) {
      return "INCONCLUSIVE";
    }
    if (typeof rawOutput === "object") {
      const obj = rawOutput as Record<string, unknown>;
      if (obj.success === false || obj.error) {
        return "FAILED";
      }
      if (obj.success === true || obj.output !== undefined) {
        return "SUCCESS";
      }
      if (Object.keys(obj).length === 0) {
        return "INCONCLUSIVE";
      }
    }
    if (typeof rawOutput === "string") {
      if (rawOutput.length === 0) return "INCONCLUSIVE";
      if (
        rawOutput.toLowerCase().includes("error") ||
        rawOutput.toLowerCase().includes("failed")
      ) {
        return "FAILED";
      }
      return "SUCCESS";
    }
    return "SUCCESS";
  }

  public async cancelRun(
    runId: string,
    reason: string,
  ): Promise<AutonomousRunRecord> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run '${runId}' not found.`);
    }

    if (TERMINAL_AUTONOMY_STATES.has(run.status)) {
      return run; // Terminal state is immutable
    }

    run.terminalReason = reason;
    this.transitionRunState(run, "CANCELLED");
    run.completedAt = new Date();

    await this.auditManager.recordEvent(
      "DECISION_MADE",
      { decision: "CANCELLED", reason },
      { workspaceId: run.workspaceId, taskId: run.taskId },
    );

    return run;
  }

  public async executeIteration(
    runId: string,
    proposal: AIProposal,
  ): Promise<AutonomousRunRecord> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Autonomy run '${runId}' not found.`);
    }

    // Fail-Closed Check 1: Immutable terminal check
    if (TERMINAL_AUTONOMY_STATES.has(run.status)) {
      return run;
    }

    const now = new Date();

    // Fail-Closed Check 2: Timeout check
    const elapsedMs = now.getTime() - run.createdAt.getTime();
    if (elapsedMs >= run.policy.maxRuntimeMs) {
      run.terminalReason = `Max runtime exceeded (${elapsedMs}ms >= ${run.policy.maxRuntimeMs}ms).`;
      this.transitionRunState(run, "TIMED_OUT");
      run.completedAt = now;
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    // Fail-Closed Check 3: Iteration limit check
    if (run.iterationsCount >= run.policy.maxIterations) {
      run.terminalReason = `Max iterations limit reached (${run.iterationsCount} >= ${run.policy.maxIterations}).`;
      this.transitionRunState(run, "LIMIT_REACHED");
      run.completedAt = now;
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    // Fail-Closed Check 4: Re-verify owner identity and active workspace membership
    if (this.identityStore) {
      const owner = this.identityStore.getUserById(run.ownerId);
      if (!owner || owner.status !== "ACTIVE") {
        run.terminalReason = `Owner '${run.ownerId}' deactivated during run execution.`;
        this.transitionRunState(run, "BLOCKED");
        run.completedAt = now;
        await this.auditManager.recordEvent(
          "DECISION_MADE",
          { decision: "BLOCKED", reason: run.terminalReason },
          { workspaceId: run.workspaceId, taskId: run.taskId },
        );
        return run;
      }

      const isMember = this.identityStore.isUserActiveWorkspaceMember(
        run.ownerId,
        run.workspaceId,
      );
      if (!isMember) {
        run.terminalReason = `Owner '${run.ownerId}' is no longer an active workspace member of '${run.workspaceId}'.`;
        this.transitionRunState(run, "BLOCKED");
        run.completedAt = now;
        await this.auditManager.recordEvent(
          "DECISION_MADE",
          { decision: "BLOCKED", reason: run.terminalReason },
          { workspaceId: run.workspaceId, taskId: run.taskId },
        );
        return run;
      }
    }

    run.iterationsCount++;
    this.transitionRunState(run, "RUNNING");
    this.transitionRunState(run, "PROPOSAL_RECEIVED");
    run.lastProposal = proposal;

    // Fail-Closed Check 5: AI Proposal Validation
    this.transitionRunState(run, "VALIDATING");
    const valRes = this.validateAIProposal(run, proposal);
    if (!valRes.valid) {
      run.terminalReason = `AI proposal validation failed: ${valRes.reason}`;
      this.transitionRunState(run, "BLOCKED");
      run.completedAt = now;
      await this.auditManager.recordEvent(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    // Fail-Closed Check 6: Check delegation limit
    if (run.delegationsCount >= run.policy.maxDelegations) {
      run.terminalReason = `Max delegations limit reached (${run.delegationsCount} >= ${run.policy.maxDelegations}).`;
      this.transitionRunState(run, "LIMIT_REACHED");
      run.completedAt = now;
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }
    run.delegationsCount++;

    // Fail-Closed Check 7: Local PolicyEngine Evaluation
    const execContext: ExecutionContext = {
      executionId: `exec_auto_${run.runId}_${run.iterationsCount}`,
      timestamp: now,
      userId: run.ownerId,
      ownerId: run.ownerId,
      workspaceId: run.workspaceId,
      environmentId: run.environmentId,
    };

    let canonicalAction = (proposal.params as any)?.action
      ? `${proposal.proposedAction}:${(proposal.params as any).action}`
      : proposal.proposedAction;
    const tool = this.toolEcosystem.getRegistry().get(proposal.proposedAction);
    if (tool && typeof tool.resolveCanonicalAction === "function") {
      canonicalAction = tool.resolveCanonicalAction(proposal.params);
    }

    const policyEval = await this.policyEngine.evaluate(
      {
        toolId: proposal.proposedAction,
        params: proposal.params,
        context: execContext,
      },
      canonicalAction,
    );

    if (
      policyEval.safetyLevel === "BLOCKED" ||
      (!policyEval.allowed && policyEval.safetyLevel !== "APPROVAL_REQUIRED")
    ) {
      run.terminalReason = `Action '${proposal.proposedAction}' explicitly BLOCKED by PolicyEngine.`;
      this.transitionRunState(run, "BLOCKED");
      run.completedAt = now;
      await this.auditManager.recordEvent(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    // Check approval mode
    if (
      policyEval.safetyLevel === "APPROVAL_REQUIRED" ||
      run.policy.approvalMode === "REQUIRE_APPROVAL" ||
      run.policy.approvalMode === "MANUAL_ONLY"
    ) {
      // Require explicit owner approval bound to exact proposal parameters
      const req = this.approvalManager.requestApproval(
        proposal.proposedAction,
        proposal.params,
        300000,
        run.workspaceId,
        run.environmentId,
        canonicalAction,
      );

      this.transitionRunState(run, "WAITING_FOR_APPROVAL");
      await this.auditManager.recordEvent(
        "DECISION_MADE",
        { decision: "APPROVAL_REQUIRED", fingerprint: req.id },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );

      return run;
    }

    // SAFE -> Execute action
    return this.executeAndVerifyAction(run, proposal, execContext);
  }

  public async approveAndContinueIteration(
    runId: string,
    approverUserId: string,
    workspaceId: string,
  ): Promise<AutonomousRunRecord> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run '${runId}' not found.`);
    }

    if (run.status !== "WAITING_FOR_APPROVAL") {
      throw new Error(
        `Run '${runId}' is in state '${run.status}', expected 'WAITING_FOR_APPROVAL'.`,
      );
    }

    if (workspaceId !== run.workspaceId) {
      run.terminalReason = "Cross-workspace approval attempt rejected.";
      this.transitionRunState(run, "BLOCKED");
      run.completedAt = new Date();
      return run;
    }

    if (this.identityStore) {
      const isMember = this.identityStore.isUserActiveWorkspaceMember(
        approverUserId,
        workspaceId,
      );
      if (!isMember) {
        run.terminalReason = `Approver '${approverUserId}' is not an active workspace member.`;
        this.transitionRunState(run, "BLOCKED");
        run.completedAt = new Date();
        return run;
      }
    }

    const proposal = run.lastProposal;
    if (!proposal) {
      run.terminalReason =
        "Missing lastProposal context for approval continuation.";
      this.transitionRunState(run, "FAILED");
      run.completedAt = new Date();
      return run;
    }

    let canonicalAction = (proposal.params as any)?.action
      ? `${proposal.proposedAction}:${(proposal.params as any).action}`
      : proposal.proposedAction;
    const tool = this.toolEcosystem.getRegistry().get(proposal.proposedAction);
    if (tool && typeof tool.resolveCanonicalAction === "function") {
      canonicalAction = tool.resolveCanonicalAction(proposal.params);
    }

    const fingerprint = this.approvalManager.createFingerprint(
      proposal.proposedAction,
      proposal.params,
      run.workspaceId,
      run.environmentId,
      canonicalAction,
    );

    const appReq = this.approvalManager.get(fingerprint);
    if (!appReq) {
      run.terminalReason =
        "No matching approval request found for exact proposal parameters.";
      this.transitionRunState(run, "BLOCKED");
      run.completedAt = new Date();
      return run;
    }

    if (appReq.status !== "APPROVED") {
      run.terminalReason = `Approval request status is '${appReq.status}', expected 'APPROVED'.`;
      this.transitionRunState(run, "BLOCKED");
      run.completedAt = new Date();
      return run;
    }

    this.transitionRunState(run, "APPROVED");

    const execContext: ExecutionContext = {
      executionId: `exec_auto_app_${run.runId}_${run.iterationsCount}`,
      timestamp: new Date(),
      userId: approverUserId,
      ownerId: run.ownerId,
      workspaceId: run.workspaceId,
      environmentId: run.environmentId,
    };

    return this.executeAndVerifyAction(run, proposal, execContext);
  }

  private async executeAndVerifyAction(
    run: AutonomousRunRecord,
    proposal: AIProposal,
    execContext: ExecutionContext,
  ): Promise<AutonomousRunRecord> {
    if (run.actionsCount >= run.policy.maxActions) {
      run.terminalReason = `Max actions limit reached (${run.actionsCount} >= ${run.policy.maxActions}).`;
      this.transitionRunState(run, "LIMIT_REACHED");
      run.completedAt = new Date();
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    run.actionsCount++;
    this.transitionRunState(run, "EXECUTING");

    // Scope selection for execution
    const selectedAgent = this.orchestrator.selectAgentForCapability(
      proposal.requestedCapability,
      run.workspaceId,
    );

    if (!selectedAgent) {
      run.terminalReason = `No agent available with capability '${proposal.requestedCapability}' for workspace '${run.workspaceId}'.`;
      this.transitionRunState(run, "FAILED");
      run.completedAt = new Date();
      return run;
    }

    const scope = this.orchestrator.createExecutionScope({
      workspaceId: run.workspaceId,
      agentId: selectedAgent.id,
      capabilities: [proposal.requestedCapability],
      tools: [proposal.proposedAction],
    });

    const executionResult = await this.toolEcosystem.execute(
      proposal.proposedAction,
      proposal.params,
      scope,
      execContext,
    );

    this.transitionRunState(run, "VERIFYING");
    const verStatus = this.verifyExecutionResult(run, executionResult.output);
    run.lastVerificationResult = verStatus;

    if (verStatus === "INCONCLUSIVE") {
      run.terminalReason = `Execution output verification returned INCONCLUSIVE for action '${proposal.proposedAction}'. Failing closed.`;
      this.transitionRunState(run, "FAILED");
      run.completedAt = new Date();
      await this.auditManager.recordEvent(
        "ACTION_FAILED",
        { reason: run.terminalReason },
        { workspaceId: run.workspaceId, taskId: run.taskId },
      );
      return run;
    }

    if (verStatus === "FAILED" || !executionResult.success) {
      if (run.retriesCount < run.policy.maxRetries) {
        run.retriesCount++;
        this.transitionRunState(run, "RETRYING");
        return run;
      } else {
        run.terminalReason =
          executionResult.error || "Action execution failed.";
        this.transitionRunState(run, "FAILED");
        run.completedAt = new Date();
        await this.auditManager.recordEvent(
          "ACTION_FAILED",
          { reason: run.terminalReason },
          { workspaceId: run.workspaceId, taskId: run.taskId },
        );
        return run;
      }
    }

    // Determine completion: if proposal is terminal or max iterations reached, complete. Otherwise stay RUNNING for next iteration.
    if (
      proposal.isTerminalProposal ||
      run.iterationsCount >= run.policy.maxIterations
    ) {
      this.transitionRunState(run, "COMPLETED");
      run.completedAt = new Date();
    } else {
      this.transitionRunState(run, "RUNNING");
    }

    await this.auditManager.recordEvent(
      "ACTION_COMPLETED",
      { runId: run.runId, action: proposal.proposedAction },
      { workspaceId: run.workspaceId, taskId: run.taskId },
    );

    return run;
  }

  private transitionRunState(
    run: AutonomousRunRecord,
    target: AutonomyLifecycleState,
  ): void {
    if (run.status === target) {
      return;
    }
    const valid = this.validateStateTransition(run.status, target);
    if (!valid) {
      throw new Error(
        `Invalid state transition from '${run.status}' to '${target}' for run '${run.runId}'.`,
      );
    }

    run.status = target;
    run.updatedAt = new Date();
    run.auditTrail.push({
      state: target,
      timestamp: run.updatedAt,
    });
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

  async recoverInterruptedTasks(atTime: Date = new Date()): Promise<{
    recoveredCount: number;
    resumedTasks: string[];
    failedRecoveryTasks: string[];
  }> {
    const keys = this.memory.listKeys("task_retry:");
    const resumedTasks: string[] = [];
    const failedRecoveryTasks: string[] = [];
    const nowIso = atTime.toISOString();

    for (const key of keys) {
      const entry = this.memory.getState<DurableRetryState>(key);
      if (entry && entry.value && entry.value.status === "RETRYING") {
        const rState = entry.value;

        if (
          !rState.taskId ||
          !rState.workspaceId ||
          typeof rState.attemptNumber !== "number" ||
          typeof rState.maxRetries !== "number"
        ) {
          rState.status = "CANCELLED";
          rState.updatedAtIso = nowIso;
          this.memory.saveState(key, rState);

          await this.auditManager.recordEvent(
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

        if (!rState.environmentId || typeof rState.environmentId !== "string") {
          rState.status = "CANCELLED";
          rState.updatedAtIso = nowIso;
          this.memory.saveState(key, rState);

          await this.auditManager.recordEvent(
            "ACTION_FAILED",
            {
              error: `Crash recovery blocked for task '${rState.taskId}': Missing environmentId in durable retry state.`,
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

        const envCheck = this.environmentManager.validateEnvironmentAccess(
          rState.environmentId,
          rState.workspaceId,
        );

        if (!envCheck.valid) {
          rState.status = "CANCELLED";
          rState.updatedAtIso = nowIso;
          this.memory.saveState(key, rState);

          await this.auditManager.recordEvent(
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

        if (rState.toolId && typeof rState.toolId === "string") {
          const rule = this.policyEngine.getRule(rState.toolId);
          if (rule === "BLOCKED") {
            rState.status = "CANCELLED";
            rState.updatedAtIso = nowIso;
            this.memory.saveState(key, rState);

            await this.auditManager.recordEvent(
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
          const req: AutonomousActionRequest = {
            taskId: rState.taskId,
            workspaceId: rState.workspaceId,
            environmentId: rState.environmentId,
            toolId: (rState.toolId as string) || "git_operate",
            params: rState.params || {},
          };

          const budget: AutonomyBudget = {
            maxActions: 5,
            maxRetries: rState.maxRetries,
            maxReplans: 1,
            usedActions: 0,
            usedRetries: rState.attemptNumber,
            usedReplans: 0,
          };

          const execContext: ExecutionContext = {
            executionId: `recovery_exec_${rState.taskId}_${Date.now()}`,
            timestamp: atTime,
          };

          const runRes = await this.runControlledAction(
            req,
            budget,
            execContext,
          );
          if (runRes.success) {
            resumedTasks.push(rState.taskId);
          } else {
            failedRecoveryTasks.push(rState.taskId);
          }
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

    if (
      !request.environmentId ||
      typeof request.environmentId !== "string" ||
      request.environmentId.trim().length === 0
    ) {
      return {
        decision: "BLOCKED",
        reason:
          "Missing mandatory environment context: environmentId is required for autonomous execution.",
        policyResult: "BLOCKED",
        approvalRequired: false,
        scopeValid: false,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: "UNSPECIFIED",
        actionToolId: request.toolId,
        timestamp: now,
      };
    }

    const envCheck = this.environmentManager.validateEnvironmentAccess(
      request.environmentId,
      request.workspaceId,
      request.toolId,
    );

    if (!envCheck.valid) {
      return {
        decision: "BLOCKED",
        reason:
          envCheck.reason ||
          `Mandatory environment boundary validation failed for environment '${request.environmentId}'.`,
        policyResult: "BLOCKED",
        approvalRequired: false,
        scopeValid: false,
        toolAuthorized: false,
        workspaceId: request.workspaceId,
        environmentId: request.environmentId,
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

    const tool = this.toolEcosystem.getRegistry().get(request.toolId);
    let canonicalAction = (request.params as any)?.action
      ? `${request.toolId}:${(request.params as any).action}`
      : request.toolId;
    if (tool && typeof tool.resolveCanonicalAction === "function") {
      canonicalAction = tool.resolveCanonicalAction(request.params);
    }

    const fingerprint = this.approvalManager.createFingerprint(
      request.toolId,
      request.params,
      request.workspaceId,
      request.environmentId,
      canonicalAction,
    );

    const rule = this.policyEngine.resolveSafetyLevel(
      request.toolId,
      canonicalAction,
    );

    if (rule === "BLOCKED") {
      return {
        decision: "BLOCKED",
        reason: `Action '${canonicalAction}' is explicitly BLOCKED by PolicyEngine.`,
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
      const approvalReq = this.approvalManager.get(
        fingerprint,
        request.params,
        request.workspaceId,
        request.environmentId,
        canonicalAction,
      );
      if (!approvalReq || approvalReq.status !== "APPROVED") {
        return {
          decision: "APPROVAL_REQUIRED",
          reason: `Action '${canonicalAction}' requires explicit owner approval.`,
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
      return {
        decision: "SAFE",
        reason: `Action '${canonicalAction}' approved and authorized.`,
        policyResult: "APPROVAL_REQUIRED",
        approvalRequired: false,
        approvalFingerprint: fingerprint,
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

    const execContext: ExecutionContext = {
      ...context,
      workspaceId: request.workspaceId,
      environmentId: request.environmentId,
    };

    const executionResult = await this.toolEcosystem.execute(
      request.toolId,
      request.params,
      scope,
      execContext,
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
