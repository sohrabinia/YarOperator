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

  // Tokenize normalized text on whitespace
  const tokens = norm.split(" ").filter(Boolean);
  const tokenSet = new Set(tokens);

  // 1. Boundary-Aware Mutation Filter: Exact token/concept check for state-changing verbs
  const mutationTokens = new Set([
    "ریستارت",
    "متوقف",
    "تغییر",
    "خاموش",
    "روشن",
    "اصلاح",
    "ویرایش",
    "حذف",
    "حذفش",
    "restart",
    "stop",
    "start",
    "modify",
    "change",
    "shutdown",
  ]);

  for (const t of tokens) {
    if (mutationTokens.has(t)) {
      return false;
    }
  }

  // 2. Boundary-Aware Negative Domain Filter: Exact token set check for unrelated domains
  const negativeTokens = new Set([
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
    "دیتابیس",
  ]);

  for (const t of tokens) {
    if (negativeTokens.has(t)) {
      return false;
    }
  }

  // Token sequence helper for exact multi-word phrase matching
  const hasTokenSequence = (seq: string[]): boolean => {
    if (tokens.length < seq.length) return false;
    for (let i = 0; i <= tokens.length - seq.length; i++) {
      let match = true;
      for (let j = 0; j < seq.length; j++) {
        if (tokens[i + j] !== seq[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  };

  if (
    hasTokenSequence(["pull", "request"]) ||
    hasTokenSequence(["وب", "سایت"]) ||
    hasTokenSequence(["پایگاه", "داده"])
  ) {
    return false;
  }

  // Reject standalone single words lacking target + concept pairing
  if (
    tokens.length === 1 &&
    (tokenSet.has("health") ||
      tokenSet.has("readiness") ||
      tokenSet.has("status") ||
      tokenSet.has("وضعیت") ||
      tokenSet.has("سلامت") ||
      tokenSet.has("آمادگی") ||
      tokenSet.has("سرور") ||
      tokenSet.has("سرویس") ||
      tokenSet.has("سیستم") ||
      tokenSet.has("اپراتور"))
  ) {
    return false;
  }

  // 3. Concept Sets Analysis using exact token set presence
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
    tokenSet.has("server");

  // Operational Health/Status Concepts
  const hasHealthConcept =
    tokenSet.has("وضعیت") ||
    tokenSet.has("وضعیتش") ||
    tokenSet.has("وضعیتی") ||
    tokenSet.has("سلامت") ||
    tokenSet.has("سالم") ||
    tokenSet.has("سالمه") ||
    tokenSet.has("آمادگی") ||
    tokenSet.has("آماده") ||
    tokenSet.has("آماده‌ست") ||
    tokenSet.has("آمادهست") ||
    tokenSet.has("status") ||
    tokenSet.has("health") ||
    tokenSet.has("readiness") ||
    tokenSet.has("healthy") ||
    tokenSet.has("ready");

  // Coherent Semantic Rule Composition
  // System-health intent REQUIRES an Operational Target Noun AND an explicit Operational Health/Status Concept.
  // Generic investigation verbs (e.g., "بررسی", "تحلیل", "توضیح") without health concepts must NOT resolve to operator_health.
  if (hasSystemTarget && hasHealthConcept) {
    return true;
  }

  // English System Health Expressions Composition
  const hasEnglishHealth =
    tokenSet.has("health") ||
    tokenSet.has("readiness") ||
    tokenSet.has("status") ||
    tokenSet.has("healthy") ||
    tokenSet.has("ready");

  if (
    hasEnglishHealth &&
    (tokenSet.has("check") ||
      tokenSet.has("report") ||
      tokenSet.has("inspect") ||
      tokenSet.has("system") ||
      tokenSet.has("operator") ||
      tokenSet.has("runtime") ||
      tokenSet.has("service") ||
      tokenSet.has("server"))
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

    // Entity Resolution for Natural Language Goals
    if (!capability && !toolId && commandTextCandidate) {
      const normText = Normalizer.normalize(commandTextCandidate);
      const isGitHub =
        normText.includes("گیت هاب") ||
        normText.includes("گیتهاب") ||
        normText.includes("github") ||
        normText.includes("ریپازیتوری") ||
        normText.includes("مخزن");

      const isYarTrader =
        normText.includes("یارتریدر") ||
        normText.includes("یار تریدر") ||
        normText.includes("yartrader");

      if (isGitHub) {
        capability = "github_operate";
        toolId = "github_operate";
      } else if (isYarTrader) {
        capability = "yartrader_adapter";
        toolId = "yartrader_adapter";
      }
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
