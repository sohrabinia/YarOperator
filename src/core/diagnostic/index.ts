import {
  ResourceRegistry,
  HttpOriginResourceConfig,
} from "../registry/resource.js";
import { ResourceResolver } from "../registry/resolver.js";
import { PolicyEngine } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { IdentityStore } from "../identity/index.js";
import { GitTool } from "../git/index.js";
import { SystemHealthProvider, OperatorHealthTool } from "../tools/index.js";
import { ExecutionContext } from "../contracts/index.js";

export interface DiagnosticItemReport {
  name: string;
  source: string;
  timestamp: string;
  status: "OK" | "FAIL" | "UNAVAILABLE";
  rawResult: string;
}

export interface DiagnosticReport {
  workspaceId: string;
  timestamp: string;
  summaryStatus: "OK" | "FAIL" | "UNAVAILABLE";
  items: DiagnosticItemReport[];
}

export interface DiagnosticWorkerParams {
  token: string;
  workspaceId: string;
  rawCommandText: string;
  targetOrigin?: string;
}

export interface DiagnosticWorkerResult {
  success: boolean;
  error?: string;
  denialStage?: string;
  report?: DiagnosticReport;
  toolExecutionCount: number;
}

export interface HttpProbeOptions {
  allowedOrigins?: string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface HttpProbeResult {
  success: boolean;
  statusCode?: number;
  body?: string;
  error?: string;
}

export class BoundedHttpProbe {
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  private privateIpPattern =
    /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.|localhost)/i;

  constructor(
    private allowedOrigins: (string | HttpOriginResourceConfig)[] = [],
    private timeoutMs: number = 5000,
    private maxResponseBytes: number = 1000,
  ) {}

  public async get(urlStr: string): Promise<HttpProbeResult> {
    try {
      const parsedUrl = new URL(urlStr);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return {
          success: false,
          error: `HTTP PROBE DENIED: Unsupported protocol '${parsedUrl.protocol}'. Only http/https allowed.`,
        };
      }

      // Origin allowlist check
      const origin = parsedUrl.origin;
      const isAllowedOrigin = this.allowedOrigins.some((allowedEntry) => {
        const allowedStr =
          typeof allowedEntry === "string"
            ? allowedEntry
            : (allowedEntry as any)?.origin || "";
        return (
          allowedStr.toLowerCase() === origin.toLowerCase() ||
          allowedStr.toLowerCase() === parsedUrl.host.toLowerCase()
        );
      });

      if (!isAllowedOrigin) {
        return {
          success: false,
          error: `HTTP PROBE DENIED: Destination origin '${origin}' is not in workspace allowedHttpOrigins.`,
        };
      }

      // SSRF private/loopback/metadata IP protection check
      const hostname = parsedUrl.hostname;
      if (this.privateIpPattern.test(hostname)) {
        // Unless explicitly allowed in origin allowlist
        if (!isAllowedOrigin) {
          return {
            success: false,
            error: `SSRF PROTECTION DENIED: Access to private/loopback/metadata host '${hostname}' is prohibited.`,
          };
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      /**
       * RESIDUAL TOCTOU / DNS REBINDING RISK DOCUMENTATION:
       * While BoundedHttpProbe validates target URLs against origin allowlists and private IP regexes
       * before dispatching fetch(), a concurrent DNS rebinding attack (where a public hostname's A record
       * is changed to a private IP between pre-check resolution and socket connection) remains a residual
       * OS-level networking race condition unless pinned at the socket level.
       */
      const response = await fetch(parsedUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "text/plain, application/json, */*",
          "User-Agent": "YarOperator-DiagnosticProbe/1.0",
        },
        redirect: "manual", // Explicit manual redirect revalidation
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle redirects with explicit destination re-validation
      if (response.status >= 300 && response.status < 400) {
        const redirectLocation = response.headers.get("location");
        if (!redirectLocation) {
          return {
            success: false,
            error: `HTTP PROBE DENIED: Redirect response ${response.status} missing Location header.`,
          };
        }

        const resolvedRedirect = new URL(redirectLocation, parsedUrl);
        const redirectOrigin = resolvedRedirect.origin;

        const isRedirectAllowed = this.allowedOrigins.some((allowedEntry) => {
          const allowedStr =
            typeof allowedEntry === "string"
              ? allowedEntry
              : (allowedEntry as any)?.origin || "";
          return (
            allowedStr.toLowerCase() === redirectOrigin.toLowerCase() ||
            allowedStr.toLowerCase() === resolvedRedirect.host.toLowerCase()
          );
        });

        if (!isRedirectAllowed) {
          return {
            success: false,
            error: `SSRF PROTECTION DENIED: Redirect to forbidden origin '${redirectOrigin}' rejected.`,
          };
        }

        return this.get(resolvedRedirect.toString());
      }

      const text = await response.text();
      const truncated = text.substring(0, this.maxResponseBytes);
      const redacted = this.redactSecrets(truncated);

      return {
        success: response.ok,
        statusCode: response.status,
        body: redacted,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return {
          success: false,
          error: `HTTP PROBE TIMEOUT: Request exceeded timeout of ${this.timeoutMs}ms.`,
        };
      }
      return {
        success: false,
        error: `HTTP PROBE FAILED: ${err.message}`,
      };
    }
  }

  private redactSecrets(text: string): string {
    if (!text) return "";
    return text.replace(
      this.sensitiveKeyPattern,
      (_match, key) => `${key}=[REDACTED]`,
    );
  }
}

export class DiagnosticWorker {
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  private allowedGitActions = new Set([
    "status",
    "rev-parse head",
    "branch --show-current",
    "log -1",
  ]);

  constructor(
    private identityStore: IdentityStore,
    private registry: ResourceRegistry,
    private resolver: ResourceResolver,
    private policyEngine: PolicyEngine,
    private auditManager: AuditManager,
    private healthProvider?: SystemHealthProvider,
  ) {}

  public static normalizeIntentText(text: string): string {
    if (!text) return "";
    return text
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/\u200c/g, " ") // ZWNJ to space
      .replace(/\s+/g, " ")
      .trim();
  }

  public resolveWorkspaceFromIntent(
    rawText: string,
  ): { workspaceId: string; matchedName: string } | null {
    const norm = DiagnosticWorker.normalizeIntentText(rawText).toLowerCase();

    for (const ws of this.registry.listWorkspaces()) {
      const candidates = [ws.workspaceId, ...(ws.aliases || [])];
      for (const cand of candidates) {
        const normCand =
          DiagnosticWorker.normalizeIntentText(cand).toLowerCase();
        if (norm.includes(normCand)) {
          return { workspaceId: ws.workspaceId, matchedName: cand };
        }
      }
    }

    return null;
  }

  public isDiagnosticIntent(rawText: string): boolean {
    const norm = DiagnosticWorker.normalizeIntentText(rawText).toLowerCase();
    const exactRequiredIntents = [
      "check yartrader status",
      "yartrader status",
      "check yartrader",
      "وضعیت yartrader رو بررسی کن",
      "وضعیت یارتریدر",
      "وضعیت یار تریدر",
    ];

    return exactRequiredIntents.includes(norm);
  }

  public escapeHtml(str: string): string {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  public redactSecrets(str: string): string {
    if (!str) return "";
    return str.replace(
      this.sensitiveKeyPattern,
      (_match, key) => `${key}=[REDACTED]`,
    );
  }

  public async executeDiagnostics(
    params: DiagnosticWorkerParams,
    context?: ExecutionContext,
    spies?: {
      gitSpy?: () => void;
      httpSpy?: () => void;
      healthSpy?: () => void;
    },
  ): Promise<DiagnosticWorkerResult> {
    let toolExecutionCount = 0;

    // --- 11-STAGE NON-NEGOTIABLE AUTHORIZATION PIPELINE ---

    // Stage 1: Authentication / Session
    if (!params.token || typeof params.token !== "string") {
      await this.auditDenial(
        "STAGE_1_AUTH",
        params.workspaceId,
        "Missing token",
      );
      return {
        success: false,
        error: "AUTHORIZATION FAILURE: Missing authentication Bearer token.",
        denialStage: "1. Authentication/Session",
        toolExecutionCount,
      };
    }

    const session = this.identityStore.getSession(params.token);
    if (!session) {
      await this.auditDenial(
        "STAGE_1_AUTH",
        params.workspaceId,
        "Invalid token session",
      );
      return {
        success: false,
        error:
          "AUTHORIZATION FAILURE: Invalid or expired Bearer token session.",
        denialStage: "1. Authentication/Session",
        toolExecutionCount,
      };
    }

    // Stage 2: IdentityStore Check
    const user = this.identityStore.getUserById(session.userId);
    if (!user) {
      await this.auditDenial(
        "STAGE_2_IDENTITY",
        params.workspaceId,
        "User not found in IdentityStore",
      );
      return {
        success: false,
        error:
          "AUTHORIZATION FAILURE: User identity not found in IdentityStore.",
        denialStage: "2. IdentityStore",
        toolExecutionCount,
      };
    }

    // Stage 3: ACTIVE User Validation
    if (user.status !== "ACTIVE") {
      await this.auditDenial(
        "STAGE_3_ACTIVE_USER",
        params.workspaceId,
        `User status is '${user.status}'`,
      );
      return {
        success: false,
        error: `AUTHORIZATION FAILURE: User identity '${user.userId}' is not ACTIVE (status: '${user.status}').`,
        denialStage: "3. ACTIVE User",
        toolExecutionCount,
      };
    }

    // Stage 4: Active Workspace Membership Validation
    if (!params.workspaceId) {
      await this.auditDenial(
        "STAGE_4_MEMBERSHIP",
        "unknown",
        "Missing workspaceId",
      );
      return {
        success: false,
        error: "AUTHORIZATION FAILURE: workspaceId is required.",
        denialStage: "4. Workspace Membership",
        toolExecutionCount,
      };
    }

    const isMember = this.identityStore.isUserActiveWorkspaceMember(
      user.userId,
      params.workspaceId,
    );
    if (!isMember) {
      await this.auditDenial(
        "STAGE_4_MEMBERSHIP",
        params.workspaceId,
        `User is not member of '${params.workspaceId}'`,
      );
      return {
        success: false,
        error: `AUTHORIZATION FAILURE: User '${user.userId}' is not an active member of workspace '${params.workspaceId}'.`,
        denialStage: "4. Workspace Membership",
        toolExecutionCount,
      };
    }

    // Stage 5: Requested Workspace Resolution
    const ws = this.registry.getWorkspace(params.workspaceId);
    if (!ws) {
      await this.auditDenial(
        "STAGE_5_REQUESTED_WORKSPACE",
        params.workspaceId,
        "Workspace not registered in ResourceRegistry",
      );
      return {
        success: false,
        error: `AUTHORIZATION FAILURE: Requested workspace '${params.workspaceId}' does not exist in ResourceRegistry.`,
        denialStage: "5. Requested Workspace",
        toolExecutionCount,
      };
    }

    // Stage 6: Authoritative Resource Registry & Path Resolution
    const rootPath = ws.allowedRoots[0];
    if (!rootPath) {
      await this.auditDenial(
        "STAGE_6_RESOURCE_REGISTRY",
        params.workspaceId,
        "Workspace has no allowedRoots",
      );
      return {
        success: false,
        error: `AUTHORIZATION FAILURE: Workspace '${params.workspaceId}' has no allowed roots configured in ResourceRegistry.`,
        denialStage: "6. Resource Registry",
        toolExecutionCount,
      };
    }

    const resourceRes = this.resolver.resolveResource(
      params.workspaceId,
      rootPath,
    );
    if (!resourceRes.success) {
      await this.auditDenial(
        "STAGE_6_RESOURCE_REGISTRY",
        params.workspaceId,
        resourceRes.error,
      );
      return {
        success: false,
        error: `AUTHORIZATION FAILURE: Resource resolution failed: ${resourceRes.error}`,
        denialStage: "6. Resource Registry",
        toolExecutionCount,
      };
    }

    // Stage 7: PolicyEngine Evaluation
    const gitRule = this.policyEngine.getRule("git_operate:status");
    if (gitRule === "BLOCKED") {
      await this.auditDenial(
        "STAGE_7_POLICY",
        params.workspaceId,
        "git_operate:status is BLOCKED by PolicyEngine",
      );
      return {
        success: false,
        error:
          "AUTHORIZATION FAILURE: Diagnostic capability 'git_operate:status' is BLOCKED by PolicyEngine.",
        denialStage: "7. PolicyEngine",
        toolExecutionCount,
      };
    }

    // Stage 8: DiagnosticWorker Read-Only Capability Resolution
    // Verify intent is actually diagnostic
    if (!this.isDiagnosticIntent(params.rawCommandText)) {
      await this.auditDenial(
        "STAGE_8_CAPABILITY",
        params.workspaceId,
        "Command text is not recognized as diagnostic intent",
      );
      return {
        success: false,
        error:
          "AUTHORIZATION FAILURE: Input text does not match recognized diagnostic intents.",
        denialStage: "8. Capability Resolution",
        toolExecutionCount,
      };
    }

    // Stage 9: Tool Authorization (Structurally exclude TerminalTool and write tools)
    // Stage 10: Execution of Read-Only Tools

    const items: DiagnosticItemReport[] = [];
    const timestamp = new Date().toISOString();

    // --- Subsystem 1: Git Read-Only Diagnostics ---
    try {
      spies?.gitSpy?.();
      toolExecutionCount++;

      const gitTool = new GitTool(this.resolver);
      const gitContext: ExecutionContext = context || {
        executionId: `diag_git_${Date.now()}`,
        timestamp: new Date(),
        workspaceId: params.workspaceId,
      };

      const gitStatusRes = await gitTool.execute(
        { action: "status", cwd: resourceRes.resource.canonicalPath },
        gitContext,
      );

      if (gitStatusRes.success) {
        const rawOut = gitStatusRes.output?.output || "Git status clean";
        items.push({
          name: "Git Status Check",
          source: "GitTool",
          timestamp,
          status: "OK",
          rawResult: this.escapeHtml(
            this.redactSecrets(rawOut.substring(0, 1000)),
          ),
        });
      } else {
        items.push({
          name: "Git Status Check",
          source: "GitTool",
          timestamp,
          status: "FAIL",
          rawResult: this.escapeHtml(gitStatusRes.error || "Git status failed"),
        });
      }
    } catch (err: any) {
      items.push({
        name: "Git Status Check",
        source: "GitTool",
        timestamp,
        status: "FAIL",
        rawResult: this.escapeHtml(err.message),
      });
    }

    // --- Subsystem 2: Bounded HTTP Probe Diagnostics ---
    if (
      params.targetOrigin ||
      (ws.allowedHttpOrigins && ws.allowedHttpOrigins.length > 0)
    ) {
      const firstOrigin = ws.allowedHttpOrigins![0];
      const probeUrl =
        params.targetOrigin ||
        (typeof firstOrigin === "string"
          ? firstOrigin
          : (firstOrigin as HttpOriginResourceConfig).origin);
      try {
        spies?.httpSpy?.();
        toolExecutionCount++;

        const httpProbe = new BoundedHttpProbe(
          ws.allowedHttpOrigins || [],
          5000,
          1000,
        );
        const probeRes = await httpProbe.get(probeUrl);

        if (probeRes.success) {
          items.push({
            name: "HTTP Origin Probe",
            source: "BoundedHttpProbe",
            timestamp,
            status: "OK",
            rawResult: this.escapeHtml(
              `HTTP ${probeRes.statusCode}: ${probeRes.body || "OK"}`,
            ),
          });
        } else {
          items.push({
            name: "HTTP Origin Probe",
            source: "BoundedHttpProbe",
            timestamp,
            status: "FAIL",
            rawResult: this.escapeHtml(probeRes.error || "HTTP probe failed"),
          });
        }
      } catch (err: any) {
        items.push({
          name: "HTTP Origin Probe",
          source: "BoundedHttpProbe",
          timestamp,
          status: "FAIL",
          rawResult: this.escapeHtml(err.message),
        });
      }
    }

    // --- Subsystem 3: Service Health Diagnostics ---
    if (this.healthProvider) {
      try {
        spies?.healthSpy?.();
        toolExecutionCount++;

        const report = this.healthProvider.getReport();
        items.push({
          name: "Service Health Check",
          source: "SystemHealthProvider",
          timestamp,
          status: report.health.status === "HEALTHY" ? "OK" : "FAIL",
          rawResult: this.escapeHtml(
            `Status: ${report.health.status}, Uptime: ${report.health.uptimeMs}ms`,
          ),
        });
      } catch (err: any) {
        items.push({
          name: "Service Health Check",
          source: "SystemHealthProvider",
          timestamp,
          status: "FAIL",
          rawResult: this.escapeHtml(err.message),
        });
      }
    } else {
      items.push({
        name: "Service Health Check",
        source: "SystemHealthProvider",
        timestamp,
        status: "UNAVAILABLE",
        rawResult: "Service health capability is UNAVAILABLE.",
      });
    }

    const summaryStatus = items.some((i) => i.status === "FAIL")
      ? "FAIL"
      : items.some((i) => i.status === "OK")
        ? "OK"
        : "UNAVAILABLE";

    const report: DiagnosticReport = {
      workspaceId: params.workspaceId,
      timestamp,
      summaryStatus,
      items,
    };

    // Stage 11: Audit Recording
    await this.auditManager.recordEvent(
      "DIAGNOSTIC_EXECUTION_COMPLETED",
      {
        workspaceId: params.workspaceId,
        summaryStatus,
        itemCount: items.length,
      },
      { workspaceId: params.workspaceId, severity: "LOW" },
    );

    return {
      success: true,
      report,
      toolExecutionCount,
    };
  }

  public validateGitAction(action: string): boolean {
    return this.allowedGitActions.has(action.trim().toLowerCase());
  }

  private async auditDenial(
    stage: string,
    workspaceId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.auditManager.recordEvent(
        "DIAGNOSTIC_AUTHORIZATION_DENIED",
        {
          stage,
          workspaceId,
          reason,
        },
        { workspaceId, severity: "HIGH" },
      );
    } catch {
      // Audit recording fail-closed
    }
  }
}
