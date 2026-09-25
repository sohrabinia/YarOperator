import {
  ResourceRegistry,
  HttpOriginResourceConfig,
} from "../registry/resource.js";
import { ResourceResolver } from "../registry/resolver.js";
import { PolicyEngine } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { IdentityStore } from "../identity/index.js";
import dns from "node:dns/promises";
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

export function parseCanonicalIpv4Number(hostOrIp: string): number | null {
  if (!hostOrIp) return null;
  const clean = hostOrIp.trim().replace(/^\[|\]$/g, "");

  if (/^(::ffff:|:ffff:)/i.test(clean)) {
    const v4Part = clean.replace(/^(::ffff:|:ffff:)/i, "");
    return parseCanonicalIpv4Number(v4Part);
  }

  const parts = clean.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const parsedParts: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let val: number;
    if (/^0x/i.test(part)) {
      val = parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
      val = parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      val = parseInt(part, 10);
    } else {
      return null;
    }
    if (isNaN(val) || val < 0) return null;
    parsedParts.push(val);
  }

  let num = 0;
  if (parsedParts.length === 4) {
    if (parsedParts.some((p) => p > 255)) return null;
    num =
      ((parsedParts[0] << 24) >>> 0) +
      (parsedParts[1] << 16) +
      (parsedParts[2] << 8) +
      parsedParts[3];
  } else if (parsedParts.length === 3) {
    if (parsedParts[0] > 255 || parsedParts[1] > 255 || parsedParts[2] > 65535)
      return null;
    num =
      ((parsedParts[0] << 24) >>> 0) + (parsedParts[1] << 16) + parsedParts[2];
  } else if (parsedParts.length === 2) {
    if (parsedParts[0] > 255 || parsedParts[1] > 16777215) return null;
    num = ((parsedParts[0] << 24) >>> 0) + parsedParts[1];
  } else if (parsedParts.length === 1) {
    if (parsedParts[0] > 4294967295) return null;
    num = parsedParts[0] >>> 0;
  }

  return num >>> 0;
}

export function isPrivateOrUnsafeIp(ipOrHost: string): boolean {
  if (!ipOrHost) return true;
  const clean = ipOrHost
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (
    clean === "localhost" ||
    clean.endsWith(".local") ||
    clean.endsWith(".internal")
  ) {
    return true;
  }

  if (clean.includes(":")) {
    if (clean === "::1" || clean === "::" || clean === "0:0:0:0:0:0:0:1") {
      return true;
    }
    if (/^fe[89ab]/i.test(clean)) return true;
    if (/^f[cd]/i.test(clean)) return true;
    if (/^(::ffff:|:ffff:)/i.test(clean)) {
      const v4Part = clean.replace(/^(::ffff:|:ffff:)/i, "");
      return isPrivateOrUnsafeIp(v4Part);
    }
  }

  const ipv4Num = parseCanonicalIpv4Number(clean);
  if (ipv4Num !== null) {
    const o1 = (ipv4Num >>> 24) & 0xff;
    const o2 = (ipv4Num >>> 16) & 0xff;

    if (o1 === 127 || o1 === 0) return true;
    if (o1 === 10) return true;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 169 && o2 === 254) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
  }

  return false;
}

export class BoundedHttpProbe {
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  constructor(
    private allowedOrigins: (string | HttpOriginResourceConfig)[] = [],
    private timeoutMs: number = 5000,
    private maxResponseBytes: number = 1000,
  ) {}

  public async get(
    urlStr: string,
    redirectCount: number = 0,
    globalDeadlineMs?: number,
  ): Promise<HttpProbeResult> {
    if (redirectCount >= 5) {
      return {
        success: false,
        error: "HTTP PROBE DENIED: Maximum redirect depth (5) exceeded.",
      };
    }

    const deadline = globalDeadlineMs ?? Date.now() + this.timeoutMs;
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      return {
        success: false,
        error: `HTTP PROBE TIMEOUT: Request exceeded global timeout deadline of ${this.timeoutMs}ms.`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);

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
          allowedStr.toLowerCase() === parsedUrl.host.toLowerCase() ||
          allowedStr === "*"
        );
      });

      if (!isAllowedOrigin) {
        return {
          success: false,
          error: `HTTP PROBE DENIED: Destination origin '${origin}' is not in workspace allowedHttpOrigins.`,
        };
      }

      const hostname = parsedUrl.hostname;

      // Check if hostname or IP is explicitly in allowedOrigins list
      const isExplicitInternalAllowed = this.allowedOrigins.some(
        (allowedEntry) => {
          const allowedStr =
            typeof allowedEntry === "string"
              ? allowedEntry
              : (allowedEntry as any)?.origin || "";
          if (allowedStr === "*") return false;
          const allowedHost = allowedStr
            .replace(/^https?:\/\//i, "")
            .toLowerCase();
          return (
            allowedHost === hostname.toLowerCase() ||
            allowedHost === `${hostname.toLowerCase()}:${parsedUrl.port}`
          );
        },
      );

      // Fail-closed DNS preflight resolution
      let resolvedIp: string | null = null;
      try {
        const resolved = await dns.lookup(hostname);
        resolvedIp = resolved.address || null;
      } catch (dnsErr: any) {
        return {
          success: false,
          error: `DNS RESOLUTION FAILED: Host '${hostname}' could not be resolved: ${dnsErr.message}`,
        };
      }

      if (!resolvedIp) {
        return {
          success: false,
          error: `DNS RESOLUTION FAILED: Host '${hostname}' resolved to empty address.`,
        };
      }

      const isHostnamePrivate = isPrivateOrUnsafeIp(hostname);
      const isResolvedIpPrivate = isPrivateOrUnsafeIp(resolvedIp);

      if (
        (isHostnamePrivate || isResolvedIpPrivate) &&
        !isExplicitInternalAllowed
      ) {
        return {
          success: false,
          error: `SSRF PROTECTION DENIED: Access to private/loopback/metadata destination '${hostname}' (${resolvedIp}) is prohibited.`,
        };
      }

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

      // Handle redirects with explicit destination re-validation
      if (response.status >= 300 && response.status < 400) {
        // Explicitly cancel/release the redirect response body before following next hop
        try {
          await response.body?.cancel();
        } catch {}

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

        return this.get(
          resolvedRedirect.toString(),
          redirectCount + 1,
          deadline,
        );
      }

      // Bounded streaming response read up to maxResponseBytes
      let bodyText = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let totalBytesRead = 0;

        while (totalBytesRead < this.maxResponseBytes) {
          const { done, value } = await reader.read();
          if (done || !value) break;

          const remainingBytes = this.maxResponseBytes - totalBytesRead;
          const chunkSlice = value.subarray(0, remainingBytes);
          totalBytesRead += chunkSlice.length;
          bodyText += decoder.decode(chunkSlice, { stream: true });

          if (totalBytesRead >= this.maxResponseBytes) {
            try {
              await reader.cancel();
            } catch {}
            break;
          }
        }
      }

      const redacted = this.redactSecrets(bodyText);

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
    } finally {
      clearTimeout(timer);
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

  public resolveDiagnosticCapability(
    rawText: string,
  ): { capability: string; gitAction?: string; toolId: string } | null {
    if (!rawText) return null;
    const norm = DiagnosticWorker.normalizeIntentText(rawText).toLowerCase();

    if (
      norm === "status" ||
      norm === "git status" ||
      this.isDiagnosticIntent(norm)
    ) {
      return {
        capability: "software-development",
        gitAction: "status",
        toolId: "git_operate:status",
      };
    }
    if (norm === "rev-parse head" || norm === "git rev-parse head") {
      return {
        capability: "software-development",
        gitAction: "rev-parse head",
        toolId: "git_operate:rev-parse head",
      };
    }
    if (
      norm === "branch --show-current" ||
      norm === "git branch --show-current"
    ) {
      return {
        capability: "software-development",
        gitAction: "branch --show-current",
        toolId: "git_operate:branch --show-current",
      };
    }
    if (norm === "log -1" || norm === "git log -1") {
      return {
        capability: "software-development",
        gitAction: "log -1",
        toolId: "git_operate:log -1",
      };
    }

    return null;
  }

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
      const auditOk = await this.auditDenial(
        "STAGE_1_AUTH",
        params.workspaceId,
        "Missing token",
      );
      return {
        success: false,
        error: auditOk
          ? "AUTHORIZATION FAILURE: Missing authentication Bearer token."
          : "AUTHORIZATION FAILURE: Missing token and audit persistence failed.",
        denialStage: "1. Authentication/Session",
        toolExecutionCount,
      };
    }

    const session = this.identityStore.getSession(params.token);
    if (!session) {
      const auditOk = await this.auditDenial(
        "STAGE_1_AUTH",
        params.workspaceId,
        "Invalid token session",
      );
      return {
        success: false,
        error: auditOk
          ? "AUTHORIZATION FAILURE: Invalid or expired Bearer token session."
          : "AUTHORIZATION FAILURE: Invalid token and audit persistence failed.",
        denialStage: "1. Authentication/Session",
        toolExecutionCount,
      };
    }

    // Stage 2: IdentityStore Check
    const user = this.identityStore.getUserById(session.userId);
    if (!user) {
      const auditOk = await this.auditDenial(
        "STAGE_2_IDENTITY",
        params.workspaceId,
        "User not found in IdentityStore",
      );
      return {
        success: false,
        error: auditOk
          ? "AUTHORIZATION FAILURE: User identity not found in IdentityStore."
          : "AUTHORIZATION FAILURE: User not found and audit persistence failed.",
        denialStage: "2. IdentityStore",
        toolExecutionCount,
      };
    }

    // Stage 3: ACTIVE User Validation
    if (user.status !== "ACTIVE") {
      const auditOk = await this.auditDenial(
        "STAGE_3_ACTIVE_USER",
        params.workspaceId,
        `User status is '${user.status}'`,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: User identity '${user.userId}' is not ACTIVE (status: '${user.status}').`
          : "AUTHORIZATION FAILURE: Inactive user and audit persistence failed.",
        denialStage: "3. ACTIVE User",
        toolExecutionCount,
      };
    }

    // Stage 4: Active Workspace Membership & Execution Context Authority Validation
    if (!params.workspaceId) {
      const auditOk = await this.auditDenial(
        "STAGE_4_MEMBERSHIP",
        "unknown",
        "Missing workspaceId",
      );
      return {
        success: false,
        error: auditOk
          ? "AUTHORIZATION FAILURE: workspaceId is required."
          : "AUTHORIZATION FAILURE: Missing workspaceId and audit persistence failed.",
        denialStage: "4. Workspace Membership",
        toolExecutionCount,
      };
    }

    if (context?.workspaceId && context.workspaceId !== params.workspaceId) {
      const auditOk = await this.auditDenial(
        "STAGE_4_MEMBERSHIP",
        params.workspaceId,
        `Context workspaceId mismatch ('${context.workspaceId}' vs '${params.workspaceId}')`,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Execution context workspaceId '${context.workspaceId}' mismatch with requested workspaceId '${params.workspaceId}'.`
          : "AUTHORIZATION FAILURE: Execution context mismatch and audit persistence failed.",
        denialStage: "4. Workspace Membership",
        toolExecutionCount,
      };
    }

    const isMember = this.identityStore.isUserActiveWorkspaceMember(
      user.userId,
      params.workspaceId,
    );
    if (!isMember) {
      const auditOk = await this.auditDenial(
        "STAGE_4_MEMBERSHIP",
        params.workspaceId,
        `User is not member of '${params.workspaceId}'`,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: User '${user.userId}' is not an active member of workspace '${params.workspaceId}'.`
          : "AUTHORIZATION FAILURE: Non-member user and audit persistence failed.",
        denialStage: "4. Workspace Membership",
        toolExecutionCount,
      };
    }

    // Stage 5: Requested Workspace Resolution
    const ws = this.registry.getWorkspace(params.workspaceId);
    if (!ws) {
      const auditOk = await this.auditDenial(
        "STAGE_5_REQUESTED_WORKSPACE",
        params.workspaceId,
        "Workspace not registered in ResourceRegistry",
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Requested workspace '${params.workspaceId}' does not exist in ResourceRegistry.`
          : "AUTHORIZATION FAILURE: Unknown workspace and audit persistence failed.",
        denialStage: "5. Requested Workspace",
        toolExecutionCount,
      };
    }

    // Stage 6: Authoritative Resource Registry & Path Resolution
    const rootPath = ws.allowedRoots[0];
    if (!rootPath) {
      const auditOk = await this.auditDenial(
        "STAGE_6_RESOURCE_REGISTRY",
        params.workspaceId,
        "Workspace has no allowedRoots",
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Workspace '${params.workspaceId}' has no allowed roots configured in ResourceRegistry.`
          : "AUTHORIZATION FAILURE: Missing allowedRoots and audit persistence failed.",
        denialStage: "6. Resource Registry",
        toolExecutionCount,
      };
    }

    const resourceRes = this.resolver.resolveResource(
      params.workspaceId,
      rootPath,
    );
    if (!resourceRes.success) {
      const auditOk = await this.auditDenial(
        "STAGE_6_RESOURCE_REGISTRY",
        params.workspaceId,
        resourceRes.error,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Resource resolution failed: ${resourceRes.error}`
          : "AUTHORIZATION FAILURE: Resource resolution failed and audit persistence failed.",
        denialStage: "6. Resource Registry",
        toolExecutionCount,
      };
    }

    // Stage 7: DiagnosticWorker Read-Only Capability Resolution
    const resolvedCapability = this.resolveDiagnosticCapability(
      params.rawCommandText,
    );
    if (!resolvedCapability || !resolvedCapability.gitAction) {
      const auditOk = await this.auditDenial(
        "STAGE_7_CAPABILITY",
        params.workspaceId,
        "Command text does not resolve to a supported diagnostic capability",
      );
      return {
        success: false,
        error: auditOk
          ? "AUTHORIZATION FAILURE: Input text does not match recognized diagnostic capabilities."
          : "AUTHORIZATION FAILURE: Unrecognized capability and audit persistence failed.",
        denialStage: "7. Capability Resolution",
        toolExecutionCount,
      };
    }

    const targetGitAction = resolvedCapability.gitAction;

    if (!this.validateGitAction(targetGitAction)) {
      const auditOk = await this.auditDenial(
        "STAGE_7_CAPABILITY",
        params.workspaceId,
        `Resolved Git action '${targetGitAction}' is not in allowed list`,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Git action '${targetGitAction}' is not allowed.`
          : "AUTHORIZATION FAILURE: Action not allowed and audit persistence failed.",
        denialStage: "7. Capability Resolution",
        toolExecutionCount,
      };
    }

    // Stage 8: PolicyEngine Evaluation for Exact Resolved Capability (MUST be explicitly SAFE)
    const gitRule = this.policyEngine.getRule(`git_operate:${targetGitAction}`);
    if (gitRule !== "SAFE") {
      const auditOk = await this.auditDenial(
        "STAGE_8_POLICY",
        params.workspaceId,
        `git_operate:${targetGitAction} rule is '${gitRule || "UNKNOWN"}' (requires SAFE)`,
      );
      return {
        success: false,
        error: auditOk
          ? `AUTHORIZATION FAILURE: Diagnostic capability 'git_operate:${targetGitAction}' rule is '${gitRule || "UNKNOWN"}'. Strictly requires SAFE rule.`
          : "AUTHORIZATION FAILURE: Policy not SAFE and audit persistence failed.",
        denialStage: "8. PolicyEngine",
        toolExecutionCount,
      };
    }

    // Stage 9: Tool Authorization (Structurally exclude TerminalTool and write tools)
    // Stage 10: Execution of Read-Only Tools

    const items: DiagnosticItemReport[] = [];
    const timestamp = new Date().toISOString();

    // --- Subsystem 1: Git Read-Only Diagnostics ---
    const gitPolicyRule = this.policyEngine.getRule(
      `git_operate:${targetGitAction}`,
    );
    if (gitPolicyRule !== "SAFE") {
      items.push({
        name: "Git Status Check",
        source: "GitTool",
        timestamp,
        status: "FAIL",
        rawResult: `AUTHORIZATION FAILURE: Policy rule for 'git_operate:${targetGitAction}' is '${gitPolicyRule || "UNKNOWN"}'. Strictly requires SAFE rule.`,
      });
    } else {
      try {
        spies?.gitSpy?.();

        const gitTool = new GitTool(this.resolver);
        const gitContext: ExecutionContext = context || {
          executionId: `diag_git_${Date.now()}`,
          timestamp: new Date(),
          workspaceId: params.workspaceId,
        };

        const gitStatusRes = await gitTool.execute(
          {
            action: targetGitAction as any,
            cwd: resourceRes.resource.canonicalPath,
          },
          gitContext,
        );

        toolExecutionCount++;

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
            rawResult: this.escapeHtml(
              gitStatusRes.error || "Git status failed",
            ),
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
    }

    // --- Subsystem 2: Bounded HTTP Probe Diagnostics ---
    if (
      params.targetOrigin ||
      (ws.allowedHttpOrigins && ws.allowedHttpOrigins.length > 0)
    ) {
      const httpPolicyRule = this.policyEngine.getRule("http_probe:get");
      if (httpPolicyRule !== "SAFE") {
        items.push({
          name: "HTTP Origin Probe",
          source: "BoundedHttpProbe",
          timestamp,
          status: "FAIL",
          rawResult: `AUTHORIZATION FAILURE: Policy rule for 'http_probe:get' is '${httpPolicyRule || "UNKNOWN"}'. Strictly requires SAFE rule.`,
        });
      } else {
        const firstOrigin = ws.allowedHttpOrigins![0];
        const probeUrl =
          params.targetOrigin ||
          (typeof firstOrigin === "string"
            ? firstOrigin
            : (firstOrigin as HttpOriginResourceConfig).origin);
        try {
          spies?.httpSpy?.();

          const httpProbe = new BoundedHttpProbe(
            ws.allowedHttpOrigins || [],
            5000,
            1000,
          );
          const probeRes = await httpProbe.get(probeUrl);
          toolExecutionCount++;

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
    }

    // --- Subsystem 3: Service Health Diagnostics ---
    if (this.healthProvider) {
      const healthPolicyRule = this.policyEngine.getRule("system_health:read");
      if (healthPolicyRule !== "SAFE") {
        items.push({
          name: "Service Health Check",
          source: "SystemHealthProvider",
          timestamp,
          status: "FAIL",
          rawResult: `AUTHORIZATION FAILURE: Policy rule for 'system_health:read' is '${healthPolicyRule || "UNKNOWN"}'. Strictly requires SAFE rule.`,
        });
      } else {
        try {
          spies?.healthSpy?.();

          const report = this.healthProvider.getReport();
          toolExecutionCount++;
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
  ): Promise<boolean> {
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
      return true;
    } catch {
      return false;
    }
  }
}
