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

  createFingerprint(toolId: string, params: unknown): string {
    const canonicalParamsJson = this.canonicalize(params || {});
    return createHash("sha256")
      .update(`${toolId}:${canonicalParamsJson}`)
      .digest("hex");
  }

  requestApproval(
    toolId: string,
    params: unknown,
    ttlMs: number = 300000,
  ): ApprovalRequest {
    const fingerprint = this.createFingerprint(toolId, params);
    const now = new Date();
    const req: ApprovalRequest = {
      id: fingerprint,
      toolId,
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
    toolId: string,
    params: unknown,
  ): { valid: boolean; reason?: string } {
    const fingerprint = this.createFingerprint(toolId, params);
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

  get(fingerprint: string): ApprovalRequest | undefined {
    return this.approvals.get(fingerprint);
  }
}

export class PolicyEngine {
  private explicitRules = new Map<string, ActionSafetyLevel>();

  constructor(private approvalManager: ApprovalManager) {}

  setRule(toolId: string, level: ActionSafetyLevel): void {
    this.explicitRules.set(toolId, level);
  }

  getRule(toolId: string): ActionSafetyLevel | undefined {
    return this.explicitRules.get(toolId);
  }

  async evaluate(
    request: ToolRequest,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const ruleLevel = this.explicitRules.get(request.toolId);

    // Explicit Policy Rule Precedence
    if (ruleLevel === "BLOCKED") {
      return {
        allowed: false,
        reason: `Tool '${request.toolId}' is explicitly BLOCKED by policy.`,
      };
    }

    if (ruleLevel === "APPROVAL_REQUIRED") {
      const consumption = this.approvalManager.consumeApproval(
        request.toolId,
        request.params,
      );
      if (!consumption.valid) {
        return {
          allowed: false,
          reason: `Approval required: ${consumption.reason}`,
        };
      }
      return { allowed: true };
    }

    if (ruleLevel === "SAFE") {
      return { allowed: true };
    }

    // Unclassified / Unknown / Ambiguous tool or action fallback -> FAIL CLOSED
    return {
      allowed: false,
      reason: `Tool '${request.toolId}' is unclassified or ambiguous and defaults to BLOCKED (fail-closed policy).`,
    };
  }
}
