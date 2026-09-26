import { BrainResult, ActionGoalCategory } from "../contracts/index.js";
import { AgentRegistry } from "../agent/index.js";

export interface CapabilityResolutionRequest {
  brainResult: BrainResult;
  workspaceId?: string;
  targetCapability?: string;
  requestedToolId?: string;
  rawCommandText?: string;
}

import { Normalizer } from "../brain/index.js";

export function isHealthReadinessIntent(text?: string): boolean {
  if (!text) return false;
  const norm = Normalizer.normalize(text);

  // Negative boundary checks: Unrelated non-system-health operational/domain contexts MUST fail closed
  const negativeKeywords = [
    "git",
    "branch",
    "commit",
    "pr",
    "pull request",
    "build",
    "test",
    "tests",
    "logs",
    "code",
    "repo",
    "repository",
    "پروژه",
    "معامله",
    "معاملات",
    "بازار",
    "داده",
    "داده‌ها",
    "داده ها",
    "فایل",
    "فایل‌ها",
    "فایل ها",
    "وب‌سایت",
    "وب سایت",
    "سایت",
  ];

  for (const neg of negativeKeywords) {
    // Check as separate word token in normalized text
    const negTokenRegex = new RegExp(`(?:^|\\s)${neg}(?:$|\\s)`, "i");
    if (negTokenRegex.test(norm)) {
      return false;
    }
  }

  // Reject standalone words without operational/system context
  if (
    norm === "health" ||
    norm === "readiness" ||
    norm === " status" ||
    norm === "وضعیت" ||
    norm === "سلامت" ||
    norm === "آمادگی"
  ) {
    return false;
  }

  // Tokens / Concepts Analysis
  const hasSystemTarget =
    norm.includes("سیستم") ||
    norm.includes("سامانه") ||
    norm.includes("سرویس") ||
    norm.includes("اپراتور") ||
    norm.includes("اوپراتور") ||
    norm.includes("system") ||
    norm.includes("operator") ||
    norm.includes("runtime") ||
    norm.includes("service");

  const hasHealthConcept =
    norm.includes("وضعیت") ||
    norm.includes("سلامت") ||
    norm.includes("سالم") ||
    norm.includes("آمادگی") ||
    norm.includes("آماده") ||
    norm.includes("status") ||
    norm.includes("health") ||
    norm.includes("readiness") ||
    norm.includes("healthy") ||
    norm.includes("ready");

  const hasActionVerb =
    norm.includes("بررسی") ||
    norm.includes("چک") ||
    norm.includes("چطوره") ||
    norm.includes("چیست") ||
    norm.includes("چگونه است") ||
    norm.includes("دارد") ||
    norm.includes("است") ||
    norm.includes("ببین") ||
    norm.includes("انجام بده") ||
    norm.includes("check") ||
    norm.includes("inspect") ||
    norm.includes("report");

  // Rule A: Explicit System Target + Health Concept
  if (hasSystemTarget && hasHealthConcept) {
    return true;
  }

  // Rule A2: Explicit System Target + Health Check Inquiry (e.g. "چک the system", "check system", "check operator", "سیستم را بررسی کن")
  if (hasSystemTarget && (hasActionVerb || norm.includes("the"))) {
    if (
      norm.includes("check") ||
      norm.includes("بررسی") ||
      norm.includes("چک")
    ) {
      return true;
    }
  }

  // Rule B: English specific patterns
  const hasEnglishHealth = norm.includes("health");
  const hasEnglishReadiness = norm.includes("readiness");
  const hasEnglishStatus = norm.includes("status");

  if (
    (hasEnglishHealth || hasEnglishReadiness || hasEnglishStatus) &&
    (norm.includes("check") ||
      norm.includes("report") ||
      norm.includes("current") ||
      norm.includes("system") ||
      norm.includes("operator") ||
      norm.includes("runtime") ||
      norm.includes("service"))
  ) {
    return true;
  }

  return false;
}

export interface CapabilityResolutionResult {
  status: "RESOLVED" | "UNRESOLVED" | "CONVERSATION" | "AMBIGUOUS";
  resolvedCapability?: string;
  resolvedToolId?: string;
  reason?: string;
  reply?: string;
}

export class CapabilityResolver {
  private static readonly GOAL_CAPABILITY_MAP: Record<
    ActionGoalCategory,
    string
  > = {
    INVESTIGATION: "software-development",
    DEVELOPMENT: "software-development",
    VERIFICATION: "terminal-execution",
    RESEARCH: "web-research",
  };

  constructor(private agentRegistry: AgentRegistry) {}

  public resolve(
    request: CapabilityResolutionRequest,
  ): CapabilityResolutionResult {
    const { brainResult, workspaceId, targetCapability, requestedToolId } =
      request;

    // 1. CONVERSATION Intent -> Preserve boundary
    if (brainResult.intent === "CONVERSATION") {
      return {
        status: "CONVERSATION",
        reply: brainResult.reply,
        resolvedCapability: "conversation",
      };
    }

    // 2. AMBIGUOUS Intent -> Preserve boundary
    if (brainResult.intent === "AMBIGUOUS") {
      return {
        status: "AMBIGUOUS",
        reason:
          brainResult.reason ||
          "Input is ambiguous and requires clarification.",
      };
    }

    // 3. ACTION Intent Resolution
    // Precedence 1: Explicit targetCapability / requestedToolId
    // Precedence 2: Operational Health/Readiness Intent -> system-monitoring / operator_health
    // Precedence 3: Brain-derived actionGoal mapping
    let capability: string | undefined = targetCapability;
    let toolId: string | undefined = requestedToolId;

    const commandTextCandidate =
      request.rawCommandText ||
      brainResult.plan?.goal ||
      (brainResult as any).rawCommandText;

    if (
      !capability &&
      !toolId &&
      isHealthReadinessIntent(commandTextCandidate)
    ) {
      capability = "system-monitoring";
      toolId = "operator_health";
    }

    if (capability === "system-monitoring" && !toolId) {
      toolId = "operator_health";
    }

    if (!capability && brainResult.actionGoal) {
      capability =
        CapabilityResolver.GOAL_CAPABILITY_MAP[brainResult.actionGoal];
    }

    // Fail Closed: Missing capability and missing actionGoal
    if (!capability) {
      return {
        status: "UNRESOLVED",
        reason:
          "No capability could be resolved from request (missing explicit capability and missing/unknown actionGoal).",
      };
    }

    // Validate capability against AgentRegistry
    const candidateAgents = this.agentRegistry.findAgentsByCapability(
      capability,
      workspaceId,
    );

    if (candidateAgents.length === 0) {
      return {
        status: "UNRESOLVED",
        resolvedCapability: capability,
        resolvedToolId: requestedToolId,
        reason: `No agent available for capability '${capability}' in workspace '${workspaceId || "any"}'.`,
      };
    }

    // Preserve explicit requestedToolId if supplied or resolved
    return {
      status: "RESOLVED",
      resolvedCapability: capability,
      resolvedToolId: toolId,
    };
  }
}
