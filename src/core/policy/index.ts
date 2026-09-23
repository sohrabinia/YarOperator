import { ActionSafetyLevel, ToolRequest } from "../contracts/index.js";
import { createHash } from "crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

export interface ApprovalRequest {
  id: string;
  toolId: string;
  action?: string;
  workspaceId?: string;
  environmentId?: string;
  ownerId?: string;
  taskId?: string;
  params?: unknown;
  normalizedParamsHash: string;
  requestedAt: Date;
  expiresAt: Date;
  status: "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED";
  approver?: string;
}

export class ApprovalManager {
  private approvals = new Map<string, ApprovalRequest>();
  private db: any = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      if (dbPath !== ":memory:") {
        const parentDir = dirname(dbPath);
        if (parentDir && parentDir !== ".") {
          mkdirSync(parentDir, { recursive: true });
        }
      }
      const { DatabaseSync } = require("node:sqlite");
      this.db = new DatabaseSync(dbPath);
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      this.initSchema();
      this.rehydrate();
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        fingerprint TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        action TEXT,
        workspace_id TEXT,
        environment_id TEXT,
        owner_id TEXT,
        task_id TEXT,
        params_json TEXT,
        normalized_params_hash TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        approver TEXT
      );
    `);
  }

  private rehydrate(): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`SELECT * FROM approvals`);
    const rows = stmt.all() as any[];
    const nowMs = Date.now();

    for (const row of rows) {
      let parsedParams = {};
      try {
        if (row.params_json) parsedParams = JSON.parse(row.params_json);
      } catch {}

      let status = row.status as ApprovalRequest["status"];
      if (nowMs > Number(row.expires_at) && status === "PENDING") {
        status = "EXPIRED";
      }

      const req: ApprovalRequest = {
        id: row.fingerprint,
        toolId: row.tool_id,
        action: row.action || undefined,
        workspaceId: row.workspace_id || undefined,
        environmentId: row.environment_id || undefined,
        ownerId: row.owner_id || undefined,
        taskId: row.task_id || undefined,
        params: parsedParams,
        normalizedParamsHash: row.normalized_params_hash,
        requestedAt: new Date(Number(row.requested_at)),
        expiresAt: new Date(Number(row.expires_at)),
        status,
        approver: row.approver || undefined,
      };

      this.approvals.set(row.fingerprint, req);
    }
  }

  private persistRecord(req: ApprovalRequest, params?: unknown): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO approvals (
        fingerprint, tool_id, action, workspace_id, environment_id, owner_id, task_id,
        params_json, normalized_params_hash, requested_at, expires_at, status, approver
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const paramsJson = JSON.stringify(params ?? req.params ?? {});

    stmt.run(
      req.id,
      req.toolId,
      req.action || null,
      req.workspaceId || null,
      req.environmentId || null,
      req.ownerId || null,
      req.taskId || null,
      paramsJson,
      req.normalizedParamsHash,
      req.requestedAt.getTime(),
      req.expiresAt.getTime(),
      req.status,
      req.approver || null,
    );
  }

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
    ownerId?: string,
    taskId?: string,
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
      action,
      workspaceId,
      environmentId,
      ownerId,
      taskId,
      params,
      normalizedParamsHash: fingerprint,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      status: "PENDING",
    };

    this.approvals.set(fingerprint, req);
    this.persistRecord(req, params);
    return req;
  }

  private fetchRecord(fingerprint: string): ApprovalRequest | undefined {
    if (this.db) {
      const stmt = this.db.prepare(
        `SELECT * FROM approvals WHERE fingerprint = ?`,
      );
      const row = stmt.get(fingerprint) as any;
      if (!row) {
        this.approvals.delete(fingerprint);
        return undefined;
      }

      let parsedParams = {};
      try {
        if (row.params_json) parsedParams = JSON.parse(row.params_json);
      } catch {}

      let status = row.status as ApprovalRequest["status"];
      if (Date.now() > Number(row.expires_at) && status === "PENDING") {
        status = "EXPIRED";
        this.db
          .prepare(
            `UPDATE approvals SET status = 'EXPIRED' WHERE fingerprint = ?`,
          )
          .run(fingerprint);
      }

      const req: ApprovalRequest = {
        id: row.fingerprint,
        toolId: row.tool_id,
        action: row.action || undefined,
        workspaceId: row.workspace_id || undefined,
        environmentId: row.environment_id || undefined,
        ownerId: row.owner_id || undefined,
        taskId: row.task_id || undefined,
        params: parsedParams,
        normalizedParamsHash: row.normalized_params_hash,
        requestedAt: new Date(Number(row.requested_at)),
        expiresAt: new Date(Number(row.expires_at)),
        status,
        approver: row.approver || undefined,
      };

      this.approvals.set(fingerprint, req);
      return req;
    }
    return this.approvals.get(fingerprint);
  }

  grantApproval(fingerprint: string, approver: string): boolean {
    const req = this.fetchRecord(fingerprint);
    if (!req) return false;

    if (new Date() > req.expiresAt) {
      req.status = "EXPIRED";
      this.persistRecord(req);
      return false;
    }

    if (req.status !== "PENDING") return false;

    req.status = "APPROVED";
    req.approver = approver;
    this.persistRecord(req);
    return true;
  }

  denyApproval(fingerprint: string): boolean {
    const req = this.fetchRecord(fingerprint);
    if (!req) return false;

    req.status = "DENIED";
    this.persistRecord(req);
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
    const req = this.fetchRecord(fingerprint);

    if (!req) {
      return {
        valid: false,
        reason: "No approval request found for fingerprint.",
      };
    }

    if (new Date() > req.expiresAt) {
      req.status = "EXPIRED";
      this.persistRecord(req, params);
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
    this.persistRecord(req, params);
    return { valid: true };
  }

  get(
    fingerprintOrToolId: string,
    params?: unknown,
    workspaceId?: string,
    environmentId?: string,
    action?: string,
  ): ApprovalRequest | undefined {
    const direct = this.fetchRecord(fingerprintOrToolId);
    if (direct) return direct;

    if (params !== undefined) {
      const fpExact = this.createFingerprint(
        fingerprintOrToolId,
        params,
        workspaceId,
        environmentId,
        action,
      );
      return this.fetchRecord(fpExact);
    }
    return undefined;
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
    }
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
    // If actionKey is specific (<toolId>:<subAction>) and not explicitly defined,
    // do NOT fall back to broad toolId rule for unknown subActions!
    if (actionKey && actionKey.includes(":") && actionKey !== toolId) {
      return undefined;
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
