import { ActionSafetyLevel, ToolRequest } from "../contracts/index.js";
import { createHash } from "crypto";

export interface ApprovalRequest {
  id: string;
  toolId: string;
  normalizedParamsHash: string;
  requestedAt: Date;
  expiresAt: Date;
  status: "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED";
  approver?: string;
}

export class ApprovalManager {
  private approvals = new Map<string, ApprovalRequest>();

  private canonicalize(obj: unknown): string {
    if (obj === null || typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map((item) => this.canonicalize(item)).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const keyValues = keys.map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${this.canonicalize(val)}`;
    });
    return "{" + keyValues.join(",") + "}";
  }

  createFingerprint(
    toolIdOrAction: string,
    params: unknown,
    workspaceId?: string,
    environmentId?: string,
    action?: string,
  ): string {
    const canonicalParamsJson = this.canonicalize(params || {});
    const toolId = toolIdOrAction.includes(":")
      ? toolIdOrAction.split(":")[0]
      : toolIdOrAction;
    const resolvedAction =
      action ||
      (toolIdOrAction.includes(":") ? toolIdOrAction : toolIdOrAction);
    const ws = workspaceId || "";
    const env = environmentId || "";

    const inputStr = `${toolId}:${resolvedAction}:${canonicalParamsJson}:${ws}:${env}`;
    return createHash("sha256").update(inputStr).digest("hex");
  }

  requestApproval(
    toolIdOrAction: string,
    params: unknown,
    ttlMs: number = 300000,
    workspaceId?: string,
    environmentId?: string,
    action?: string,
  ): ApprovalRequest {
    const fingerprint = this.createFingerprint(
      toolIdOrAction,
      params,
      workspaceId,
      environmentId,
      action,
    );
    const now = new Date();
    const req: ApprovalRequest = {
      id: fingerprint,
      toolId: toolIdOrAction,
      normalizedParamsHash: fingerprint,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      status: "PENDING",
    };

    this.approvals.set(fingerprint, req);
    return req;
  }

  grantApproval(fingerprint: string, approver: string): boolean {
    const req = this.approvals.get(fingerprint);
    if (!req) return false;

    if (new Date() > req.expiresAt) {
      req.status = "EXPIRED";
      return false;
    }

    if (req.status !== "PENDING") return false;

    req.status = "APPROVED";
    req.approver = approver;
    return true;
  }

  denyApproval(fingerprint: string): boolean {
    const req = this.approvals.get(fingerprint);
    if (!req) return false;

    req.status = "DENIED";
    return true;
  }

  consumeApproval(
    toolIdOrAction: string,
    params: unknown,
    workspaceId?: string,
    environmentId?: string,
    action?: string,
  ): { valid: boolean; reason?: string } {
    const fingerprint = this.createFingerprint(
      toolIdOrAction,
      params,
      workspaceId,
      environmentId,
      action,
    );
    const req = this.approvals.get(fingerprint);

    if (!req) {
      return {
        valid: false,
        reason: "No approval request found for fingerprint.",
      };
    }

    if (new Date() > req.expiresAt) {
      req.status = "EXPIRED";
      return { valid: false, reason: "Approval request has expired." };
    }

    if (req.status === "CONSUMED") {
      return {
        valid: false,
        reason:
          "Approval single-use token already consumed (replay attack protection).",
      };
    }

    if (req.status !== "APPROVED") {
      return {
        valid: false,
        reason: `Approval status is '${req.status}', expected 'APPROVED'.`,
      };
    }

    req.status = "CONSUMED";
    return { valid: true };
  }

  get(
    fingerprintOrToolId: string,
    params?: unknown,
    workspaceId?: string,
    environmentId?: string,
    action?: string,
  ): ApprovalRequest | undefined {
    const direct = this.approvals.get(fingerprintOrToolId);
    if (direct) return direct;

    if (params !== undefined) {
      const fpExact = this.createFingerprint(
        fingerprintOrToolId,
        params,
        workspaceId,
        environmentId,
        action,
      );
      return this.approvals.get(fpExact);
    }
    return undefined;
  }
}

export class PolicyEngine {
  private explicitRules = new Map<string, ActionSafetyLevel>();

  constructor(private approvalManager?: ApprovalManager) {}

  setRule(toolIdOrAction: string, level: ActionSafetyLevel): void {
    this.explicitRules.set(toolIdOrAction, level);
  }

  getRule(toolIdOrAction: string): ActionSafetyLevel | undefined {
    return this.explicitRules.get(toolIdOrAction);
  }

  resolveSafetyLevel(
    toolId: string,
    actionKey?: string,
  ): ActionSafetyLevel | undefined {
    if (actionKey && this.explicitRules.has(actionKey)) {
      return this.explicitRules.get(actionKey);
    }
    if (this.explicitRules.has(toolId)) {
      return this.explicitRules.get(toolId);
    }
    return undefined;
  }

  async evaluate(
    request: ToolRequest,
    actionKey?: string,
  ): Promise<{
    allowed: boolean;
    safetyLevel?: ActionSafetyLevel;
    reason?: string;
  }> {
    const targetKey = actionKey || request.toolId;
    const ruleLevel = this.resolveSafetyLevel(request.toolId, actionKey);

    if (ruleLevel === "BLOCKED") {
      return {
        allowed: false,
        safetyLevel: "BLOCKED",
        reason: `Action '${targetKey}' is explicitly BLOCKED by policy.`,
      };
    }

    if (ruleLevel === "APPROVAL_REQUIRED") {
      return {
        allowed: false,
        safetyLevel: "APPROVAL_REQUIRED",
        reason: `Approval required: Action '${targetKey}' requires owner approval before execution.`,
      };
    }

    if (ruleLevel === "SAFE") {
      return { allowed: true, safetyLevel: "SAFE" };
    }

    // Unclassified / Unknown / Ambiguous tool or action fallback -> FAIL CLOSED
    return {
      allowed: false,
      safetyLevel: "BLOCKED",
      reason: `Action '${targetKey}' is unclassified or ambiguous and defaults to BLOCKED (fail-closed policy).`,
    };
  }
}
