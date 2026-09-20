import { IdentityStore } from "../identity/index.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { ExecutionContext } from "../contracts/index.js";

export type DelegationStatus =
  | "CREATED"
  | "AUTHORIZED"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "DISPATCHED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "REJECTED"
  | "BLOCKED";

export type VerificationStatus = "PENDING" | "PASSED" | "FAILED" | "REJECTED";

export interface ExternalAIDelegationRequest {
  id: string;
  ownerId: string;
  workspaceId: string;
  purpose: string;
  requestedCapability: string;
  input: Record<string, unknown> | string;
  providerId: string;
  timeoutMs?: number;
  maxResponseSize?: number;
  maxRetries?: number;
  allowedScope?: string[];
}

export interface ExternalAIRawResult {
  success: boolean;
  taskId?: string;
  workspaceId?: string;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  scopeExpansionAttempted?: boolean;
  attemptedActions?: string[];
}

export interface ExternalAIProvider {
  id: string;
  name: string;
  execute(
    request: ExternalAIDelegationRequest,
    signal?: AbortSignal,
  ): Promise<ExternalAIRawResult>;
}

export interface ExternalAIDelegationRecord {
  id: string;
  ownerId: string;
  workspaceId: string;
  purpose: string;
  requestedCapability: string;
  input: unknown;
  providerId: string;
  status: DelegationStatus;
  result?: unknown;
  error?: string;
  verificationStatus: VerificationStatus;
  cancellationReason?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  dispatchedAt?: Date;
  completedAt?: Date;
  approvalFingerprint?: string;
  approvalStatus?: string;
  retryCount: number;
  timeoutMs: number;
  maxResponseSize: number;
  maxRetries: number;
}

export class ExternalAICoordinator {
  private providers = new Map<string, ExternalAIProvider>();
  private delegations = new Map<string, ExternalAIDelegationRecord>();

  constructor(
    private identityStore: IdentityStore,
    private policyEngine: PolicyEngine,
    private approvalManager: ApprovalManager,
    private auditManager?: AuditManager,
  ) {}

  public registerProvider(provider: ExternalAIProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): ExternalAIProvider | undefined {
    return this.providers.get(id);
  }

  public getDelegation(id: string): ExternalAIDelegationRecord | undefined {
    return this.delegations.get(id);
  }

  public sanitizeInput(input: unknown): unknown {
    if (typeof input === "string") {
      return this.redactSecretsInString(input);
    }
    if (input === null || typeof input !== "object") {
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((item) => this.sanitizeInput(item));
    }
    const cleanObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (
        /(PASSWORD|SECRET|TOKEN|BEARER|AUTH|API_KEY|COOKIE|SESSION|PRIVATE_KEY)/i.test(
          key,
        )
      ) {
        cleanObj[key] = "[REDACTED_CREDENTIAL]";
      } else {
        cleanObj[key] = this.sanitizeInput(val);
      }
    }
    return cleanObj;
  }

  private redactSecretsInString(text: string): string {
    if (!text) return "";
    return text.replace(
      /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER|COOKIE|SESSION|PRIVATE_KEY)[=:\s]+[^\s"'&,]+/gi,
      (_match, key) => `${key}=[REDACTED_CREDENTIAL]`,
    );
  }

  private async audit(
    type:
      | "TASK_CREATED"
      | "DECISION_MADE"
      | "ACTION_STARTED"
      | "ACTION_COMPLETED"
      | "ACTION_FAILED",
    payload: Record<string, unknown>,
    options?: {
      workspaceId?: string;
      taskId?: string;
      severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    },
  ): Promise<void> {
    if (this.auditManager) {
      await this.auditManager.recordEvent(type, payload, options);
    }
  }

  public async delegate(
    request: ExternalAIDelegationRequest,
  ): Promise<ExternalAIDelegationRecord> {
    const now = new Date();
    const timeoutMs = request.timeoutMs ?? 15000;
    const maxResponseSize = request.maxResponseSize ?? 100000;
    const maxRetries = request.maxRetries ?? 0;

    // Fail-Closed Gate 1: Check required identity fields
    if (!request.ownerId || !request.workspaceId || !request.id) {
      const rec: ExternalAIDelegationRecord = {
        id: request.id || `del_${Date.now()}`,
        ownerId: request.ownerId || "",
        workspaceId: request.workspaceId || "",
        purpose: request.purpose || "",
        requestedCapability: request.requestedCapability || "",
        input: this.sanitizeInput(request.input),
        providerId: request.providerId || "",
        status: "BLOCKED",
        verificationStatus: "REJECTED",
        rejectionReason:
          "Missing required ownerId, workspaceId, or taskId context.",
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        timeoutMs,
        maxResponseSize,
        maxRetries,
      };
      if (rec.id) this.delegations.set(rec.id, rec);
      await this.audit(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: rec.rejectionReason },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    // Fail-Closed Gate 2: Verify owner identity existence & active workspace membership
    const owner = this.identityStore.getUserById(request.ownerId);
    if (!owner || owner.status !== "ACTIVE") {
      const rec: ExternalAIDelegationRecord = {
        id: request.id,
        ownerId: request.ownerId,
        workspaceId: request.workspaceId,
        purpose: request.purpose,
        requestedCapability: request.requestedCapability,
        input: this.sanitizeInput(request.input),
        providerId: request.providerId,
        status: "BLOCKED",
        verificationStatus: "REJECTED",
        rejectionReason: `Owner '${request.ownerId}' does not exist or is disabled.`,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        timeoutMs,
        maxResponseSize,
        maxRetries,
      };
      this.delegations.set(rec.id, rec);
      await this.audit(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: rec.rejectionReason },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    const isMember = this.identityStore.isUserActiveWorkspaceMember(
      request.ownerId,
      request.workspaceId,
    );
    if (!isMember) {
      const rec: ExternalAIDelegationRecord = {
        id: request.id,
        ownerId: request.ownerId,
        workspaceId: request.workspaceId,
        purpose: request.purpose,
        requestedCapability: request.requestedCapability,
        input: this.sanitizeInput(request.input),
        providerId: request.providerId,
        status: "BLOCKED",
        verificationStatus: "REJECTED",
        rejectionReason: `Owner '${request.ownerId}' is not an active member of workspace '${request.workspaceId}'.`,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        timeoutMs,
        maxResponseSize,
        maxRetries,
      };
      this.delegations.set(rec.id, rec);
      await this.audit(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: rec.rejectionReason },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    // Fail-Closed Gate 3: Verify provider existence
    const provider = this.getProvider(request.providerId);
    if (!provider) {
      const rec: ExternalAIDelegationRecord = {
        id: request.id,
        ownerId: request.ownerId,
        workspaceId: request.workspaceId,
        purpose: request.purpose,
        requestedCapability: request.requestedCapability,
        input: this.sanitizeInput(request.input),
        providerId: request.providerId,
        status: "BLOCKED",
        verificationStatus: "REJECTED",
        rejectionReason: `External AI Provider '${request.providerId}' is not registered or unavailable.`,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        timeoutMs,
        maxResponseSize,
        maxRetries,
      };
      this.delegations.set(rec.id, rec);
      await this.audit(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: rec.rejectionReason },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    // Fail-Closed Gate 4: Policy evaluation
    const execContext: ExecutionContext = {
      executionId: `exec_del_${request.id}`,
      timestamp: now,
      userId: request.ownerId,
      ownerId: request.ownerId,
      workspaceId: request.workspaceId,
      environmentId: `env_${request.workspaceId}`,
    };

    const policyResult = await this.policyEngine.evaluate({
      toolId: request.requestedCapability,
      params: { purpose: request.purpose, input: request.input },
      context: execContext,
    });

    const sanitizedInput = this.sanitizeInput(request.input);

    const rec: ExternalAIDelegationRecord = {
      id: request.id,
      ownerId: request.ownerId,
      workspaceId: request.workspaceId,
      purpose: request.purpose,
      requestedCapability: request.requestedCapability,
      input: sanitizedInput,
      providerId: request.providerId,
      status: "CREATED",
      verificationStatus: "PENDING",
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      timeoutMs,
      maxResponseSize,
      maxRetries,
    };
    this.delegations.set(rec.id, rec);
    await this.audit(
      "TASK_CREATED",
      {
        delegationId: request.id,
        capability: request.requestedCapability,
        provider: request.providerId,
      },
      { workspaceId: request.workspaceId, taskId: request.id },
    );

    if (
      policyResult.safetyLevel === "BLOCKED" ||
      (!policyResult.allowed &&
        policyResult.safetyLevel !== "APPROVAL_REQUIRED")
    ) {
      rec.status = "BLOCKED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason =
        policyResult.reason || "PolicyEngine blocked capability execution.";
      rec.updatedAt = new Date();
      await this.audit(
        "DECISION_MADE",
        { decision: "BLOCKED", reason: rec.rejectionReason },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    if (policyResult.safetyLevel === "APPROVAL_REQUIRED") {
      const approvalParams = {
        taskId: request.id,
        workspaceId: request.workspaceId,
        ownerId: request.ownerId,
        purpose: request.purpose,
        capability: request.requestedCapability,
        input: sanitizedInput,
      };
      const req = this.approvalManager.requestApproval(
        request.requestedCapability,
        approvalParams,
        300000,
        request.workspaceId,
        `env_${request.workspaceId}`,
        request.requestedCapability,
      );
      rec.status = "APPROVAL_REQUIRED";
      rec.approvalFingerprint = req.id;
      rec.approvalStatus = "PENDING";
      rec.updatedAt = new Date();
      await this.audit(
        "DECISION_MADE",
        { decision: "APPROVAL_REQUIRED", fingerprint: req.id },
        { workspaceId: request.workspaceId, taskId: request.id },
      );
      return rec;
    }

    // SAFE -> Authorized to dispatch
    rec.status = "AUTHORIZED";
    rec.updatedAt = new Date();
    await this.audit(
      "DECISION_MADE",
      { decision: "AUTHORIZED" },
      { workspaceId: request.workspaceId, taskId: request.id },
    );

    return this.dispatchDelegation(rec, provider, request);
  }

  public async approveDelegation(
    delegationId: string,
    approverUserId: string,
    workspaceId: string,
  ): Promise<ExternalAIDelegationRecord> {
    const rec = this.delegations.get(delegationId);
    if (!rec) {
      throw new Error(`Delegation '${delegationId}' not found.`);
    }

    if (rec.status !== "APPROVAL_REQUIRED") {
      throw new Error(
        `Delegation '${delegationId}' is in state '${rec.status}', expected 'APPROVAL_REQUIRED'.`,
      );
    }

    // Verify approver is active workspace member and matches workspace
    if (workspaceId !== rec.workspaceId) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = "Cross-workspace approval attempt rejected.";
      rec.updatedAt = new Date();
      await this.audit(
        "DECISION_MADE",
        { decision: "APPROVAL_REJECTED", reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    const isMember = this.identityStore.isUserActiveWorkspaceMember(
      approverUserId,
      workspaceId,
    );
    if (!isMember) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = `Approver '${approverUserId}' is not an active member of workspace '${workspaceId}'.`;
      rec.updatedAt = new Date();
      await this.audit(
        "DECISION_MADE",
        { decision: "APPROVAL_REJECTED", reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    if (rec.approvalFingerprint) {
      this.approvalManager.grantApproval(
        rec.approvalFingerprint,
        approverUserId,
      );
    }

    const approvalParams = {
      taskId: rec.id,
      workspaceId: rec.workspaceId,
      ownerId: rec.ownerId,
      purpose: rec.purpose,
      capability: rec.requestedCapability,
      input: rec.input,
    };

    // Consume approval single-use token
    const consumeRes = this.approvalManager.consumeApproval(
      rec.requestedCapability,
      approvalParams,
      rec.workspaceId,
      `env_${rec.workspaceId}`,
      rec.requestedCapability,
    );

    if (!consumeRes.valid) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = `Approval invalid/expired/replayed: ${consumeRes.reason}`;
      rec.updatedAt = new Date();
      await this.audit(
        "DECISION_MADE",
        { decision: "APPROVAL_REJECTED", reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    rec.status = "APPROVED";
    rec.approvalStatus = "APPROVED";
    rec.updatedAt = new Date();
    await this.audit(
      "DECISION_MADE",
      { decision: "APPROVED", approver: approverUserId },
      { workspaceId: rec.workspaceId, taskId: rec.id },
    );

    const provider = this.getProvider(rec.providerId);
    if (!provider) {
      rec.status = "FAILED";
      rec.verificationStatus = "FAILED";
      rec.error = `Provider '${rec.providerId}' unavailable after approval.`;
      rec.updatedAt = new Date();
      return rec;
    }

    const origRequest: ExternalAIDelegationRequest = {
      id: rec.id,
      ownerId: rec.ownerId,
      workspaceId: rec.workspaceId,
      purpose: rec.purpose,
      requestedCapability: rec.requestedCapability,
      input: rec.input as any,
      providerId: rec.providerId,
      timeoutMs: rec.timeoutMs,
      maxResponseSize: rec.maxResponseSize,
      maxRetries: rec.maxRetries,
    };

    return this.dispatchDelegation(rec, provider, origRequest);
  }

  public async cancelDelegation(
    delegationId: string,
    reason: string,
  ): Promise<ExternalAIDelegationRecord> {
    const rec = this.delegations.get(delegationId);
    if (!rec) {
      throw new Error(`Delegation '${delegationId}' not found.`);
    }

    // Terminal states cannot be cancelled
    if (
      [
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "REJECTED",
        "BLOCKED",
      ].includes(rec.status)
    ) {
      return rec;
    }

    rec.status = "CANCELLED";
    rec.verificationStatus = "REJECTED";
    rec.cancellationReason = reason;
    rec.updatedAt = new Date();
    rec.completedAt = new Date();
    await this.audit(
      "DECISION_MADE",
      { decision: "CANCELLED", reason },
      { workspaceId: rec.workspaceId, taskId: rec.id },
    );
    return rec;
  }

  private async dispatchDelegation(
    rec: ExternalAIDelegationRecord,
    provider: ExternalAIProvider,
    request: ExternalAIDelegationRequest,
  ): Promise<ExternalAIDelegationRecord> {
    rec.status = "DISPATCHED";
    rec.dispatchedAt = new Date();
    rec.updatedAt = new Date();
    await this.audit(
      "ACTION_STARTED",
      { providerId: provider.id, taskId: rec.id },
      { workspaceId: rec.workspaceId, taskId: rec.id },
    );

    rec.status = "RUNNING";
    rec.updatedAt = new Date();

    const sanitizedReqForProvider: ExternalAIDelegationRequest = {
      ...request,
      input: rec.input as any,
    };

    const abortController = new AbortController();
    let isTimedOut = false;

    const timer = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, rec.timeoutMs);

    let rawRes: ExternalAIRawResult | null = null;

    try {
      let attempts = 0;
      let lastError: string | null = null;

      while (attempts <= rec.maxRetries) {
        if (
          this.delegations.get(rec.id)?.status === "CANCELLED" ||
          isTimedOut
        ) {
          break;
        }

        try {
          rawRes = await provider.execute(
            sanitizedReqForProvider,
            abortController.signal,
          );
          if (rawRes) {
            break;
          }
        } catch (err: any) {
          lastError = err?.message || String(err);
          attempts++;
          rec.retryCount = attempts;
          if (
            attempts <= rec.maxRetries &&
            !isTimedOut &&
            this.delegations.get(rec.id)?.status !== "CANCELLED"
          ) {
            await new Promise((res) => setTimeout(res, 20));
          }
        }
      }

      clearTimeout(timer);

      if (this.delegations.get(rec.id)?.status === "CANCELLED") {
        rec.verificationStatus = "REJECTED";
        rec.updatedAt = new Date();
        return rec;
      }

      if (isTimedOut) {
        rec.status = "TIMED_OUT";
        rec.verificationStatus = "FAILED";
        rec.error = `Delegation execution timed out after ${rec.timeoutMs}ms.`;
        rec.updatedAt = new Date();
        rec.completedAt = new Date();
        await this.audit(
          "ACTION_FAILED",
          { reason: rec.error },
          { workspaceId: rec.workspaceId, taskId: rec.id },
        );
        return rec;
      }

      if (!rawRes) {
        rec.status = "FAILED";
        rec.verificationStatus = "FAILED";
        rec.error =
          lastError || "Provider returned null or failed without output.";
        rec.updatedAt = new Date();
        rec.completedAt = new Date();
        await this.audit(
          "ACTION_FAILED",
          { reason: rec.error },
          { workspaceId: rec.workspaceId, taskId: rec.id },
        );
        return rec;
      }

      return this.verifyAndFinalizeResult(rec, rawRes);
    } catch (err: any) {
      clearTimeout(timer);

      if (this.delegations.get(rec.id)?.status === "CANCELLED") {
        return rec;
      }

      if (isTimedOut || err?.name === "AbortError") {
        rec.status = "TIMED_OUT";
        rec.verificationStatus = "FAILED";
        rec.error = `Delegation execution timed out after ${rec.timeoutMs}ms.`;
        rec.updatedAt = new Date();
        rec.completedAt = new Date();
        await this.audit(
          "ACTION_FAILED",
          { reason: rec.error },
          { workspaceId: rec.workspaceId, taskId: rec.id },
        );
        return rec;
      }

      rec.status = "FAILED";
      rec.verificationStatus = "FAILED";
      rec.error = err?.message || String(err);
      rec.updatedAt = new Date();
      rec.completedAt = new Date();
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.error },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }
  }

  private async verifyAndFinalizeResult(
    rec: ExternalAIDelegationRecord,
    rawRes: ExternalAIRawResult,
  ): Promise<ExternalAIDelegationRecord> {
    rec.completedAt = new Date();
    rec.updatedAt = new Date();

    // Verification 1: Task ID match
    if (rawRes.taskId && rawRes.taskId !== rec.id) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = `Result taskId '${rawRes.taskId}' does not match delegation request id '${rec.id}'.`;
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    // Verification 2: Workspace ID match
    if (rawRes.workspaceId && rawRes.workspaceId !== rec.workspaceId) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = `Result workspaceId '${rawRes.workspaceId}' does not match delegation workspaceId '${rec.workspaceId}'.`;
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    // Verification 3: Scope expansion check
    if (rawRes.scopeExpansionAttempted) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason =
        "External AI attempted unauthorized scope expansion or privileged action.";
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    // Check attempted actions in output or metadata for scope expansion patterns
    const outputStr =
      typeof rawRes.output === "string"
        ? rawRes.output
        : JSON.stringify(rawRes.output || {});
    if (
      /(EXECUTE_PRODUCTION|MODIFY_AUTHORIZATION|CREATE_CREDENTIAL|SUDO|GRANT_PERMISSION|MODIFY_REPOSITORY_Y)/i.test(
        outputStr,
      )
    ) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason =
        "External AI response contains privileged execution triggers or scope expansion attempts.";
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    // Verification 4: Output size limit
    if (outputStr.length > rec.maxResponseSize) {
      rec.status = "REJECTED";
      rec.verificationStatus = "REJECTED";
      rec.rejectionReason = `Response size (${outputStr.length} chars) exceeds maximum allowed limit (${rec.maxResponseSize} chars).`;
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.rejectionReason },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    if (!rawRes.success) {
      rec.status = "FAILED";
      rec.verificationStatus = "FAILED";
      rec.error = rawRes.error || "Provider returned explicit failure status.";
      await this.audit(
        "ACTION_FAILED",
        { reason: rec.error },
        { workspaceId: rec.workspaceId, taskId: rec.id },
      );
      return rec;
    }

    rec.status = "SUCCEEDED";
    rec.verificationStatus = "PASSED";
    rec.result = rawRes.output;
    await this.audit(
      "ACTION_COMPLETED",
      { providerId: rec.providerId, resultStatus: "PASSED" },
      { workspaceId: rec.workspaceId, taskId: rec.id },
    );

    return rec;
  }
}
