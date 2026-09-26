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
  if (!norm) return false;

  const tokens = norm.split(" ").filter(Boolean);
  const tokenSet = new Set(tokens);

  // 1. Negative Mutation Filter: State-changing verbs must NEVER resolve to read-only operator_health:check
  const mutationKeywords = [
    "ریستارت",
    "متوقف",
    "تغییر",
    "خاموش",
    "روشن",
    "راه",
    "اندازی",
    "اصلاح",
    "ویرایش",
    "restart",
    "stop",
    "start",
    "modify",
    "change",
    "shutdown",
  ];
  for (const m of mutationKeywords) {
    if (tokenSet.has(m) || norm.includes(m)) {
      return false;
    }
  }

  // 2. Negative Domain Filter: Unrelated operational domains must NOT enter system health monitoring
  const negativeTokens = [
    "git",
    "github",
    "branch",
    "commit",
    "pr",
    "pull",
    "request",
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
    "دادهها",
    "فایل",
    "فایل‌ها",
    "فایلها",
    "وبسایت",
    "وب‌سایت",
    "سایت",
    "دیتابیس",
  ];

  for (const neg of negativeTokens) {
    if (tokenSet.has(neg)) {
      return false;
    }
  }

  if (
    norm.includes("pull request") ||
    norm.includes("وب سایت") ||
    norm.includes("وب‌سایت") ||
    norm.includes("پایگاه داده")
  ) {
    return false;
  }

  // Reject standalone words lacking an explicit target/concept pairing
  if (
    norm === "health" ||
    norm === "readiness" ||
    norm === "status" ||
    norm === "وضعیت" ||
    norm === "سلامت" ||
    norm === "آمادگی" ||
    norm === "سرور" ||
    norm === "سرویس" ||
    norm === "سیستم" ||
    norm === "اپراتور"
  ) {
    return false;
  }

  // 3. Concept Sets Analysis
  // Operational Target Nouns
  const hasSystemTarget =
    tokenSet.has("سیستم") ||
    tokenSet.has("سامانه") ||
    tokenSet.has("سرویس") ||
    tokenSet.has("سرویس‌ها") ||
    tokenSet.has("سرویسها") ||
    tokenSet.has("اپراتور") ||
    tokenSet.has("اوپراتور") ||
    tokenSet.has("سرور") ||
    tokenSet.has("سرورها") ||
    tokenSet.has("system") ||
    tokenSet.has("operator") ||
    tokenSet.has("runtime") ||
    tokenSet.has("service") ||
    tokenSet.has("services") ||
    tokenSet.has("server") ||
    norm.includes("سیستم") ||
    norm.includes("سامانه") ||
    norm.includes("سرویس") ||
    norm.includes("اپراتور") ||
    norm.includes("اوپراتور") ||
    norm.includes("سرور");

  // Operational Health/Status Concepts
  const hasHealthConcept =
    tokenSet.has("وضعیت") ||
    tokenSet.has("سلامت") ||
    tokenSet.has("سالم") ||
    tokenSet.has("سالمه") ||
    tokenSet.has("آمادگی") ||
    tokenSet.has("آماده") ||
    tokenSet.has("وضعیتش") ||
    tokenSet.has("وضعیتش") ||
    tokenSet.has("status") ||
    tokenSet.has("health") ||
    tokenSet.has("readiness") ||
    tokenSet.has("healthy") ||
    tokenSet.has("ready") ||
    norm.includes("وضعیت") ||
    norm.includes("سلامت") ||
    norm.includes("سالم") ||
    norm.includes("آماده") ||
    norm.includes("آمادگی") ||
    norm.includes("چه وضعیتی");

  // Inquiry/Check Concepts
  const hasInquiryConcept =
    tokenSet.has("بررسی") ||
    tokenSet.has("چک") ||
    tokenSet.has("چطوره") ||
    tokenSet.has("چیست") ||
    tokenSet.has("ببین") ||
    tokenSet.has("بگو") ||
    tokenSet.has("check") ||
    tokenSet.has("inspect") ||
    tokenSet.has("report") ||
    norm.includes("بررسی") ||
    norm.includes("چک") ||
    norm.includes("چطوره") ||
    norm.includes("چگونه است");

  // Rule Composition Enforcement
  // Must possess a valid Target Noun AND an Operational Health/Status Concept or Health Inquiry Verb
  if (hasSystemTarget && (hasHealthConcept || hasInquiryConcept)) {
    return true;
  }

  // English Expressions Composition
  const hasEnglishHealth =
    tokenSet.has("health") ||
    tokenSet.has("readiness") ||
    tokenSet.has("status");
  if (
    hasEnglishHealth &&
    (tokenSet.has("check") ||
      tokenSet.has("report") ||
      tokenSet.has("inspect") ||
      tokenSet.has("system") ||
      tokenSet.has("operator") ||
      tokenSet.has("runtime") ||
      tokenSet.has("service") ||
      tokenSet.has("server") ||
      tokenSet.has("healthy") ||
      tokenSet.has("ready"))
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
