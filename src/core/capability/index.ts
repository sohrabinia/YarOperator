import { BrainResult, ActionGoalCategory } from "../contracts/index.js";
import { AgentRegistry } from "../agent/index.js";

export interface CapabilityResolutionRequest {
  brainResult: BrainResult;
  workspaceId?: string;
  targetCapability?: string;
  requestedToolId?: string;
  rawCommandText?: string;
}

export function isHealthReadinessIntent(text?: string): boolean {
  if (!text) return false;
  const norm = text.toLowerCase().trim();

  // Negative checks for non-health operational contexts
  if (
    norm.includes("git") ||
    norm.includes("branch") ||
    norm.includes("commit") ||
    norm.includes("pull request") ||
    norm.includes("pr ") ||
    norm.includes(" pr") ||
    norm.includes("build") ||
    norm.includes("test") ||
    norm.includes("logs") ||
    norm.includes("code")
  ) {
    return false;
  }

  // Positive English patterns
  const hasHealth = norm.includes("health");
  const hasReadiness = norm.includes("readiness");
  const hasOperator = norm.includes("operator");
  const hasRuntime = norm.includes("runtime");

  if (hasOperator && (hasHealth || hasReadiness)) return true;
  if (hasRuntime && (hasHealth || hasReadiness)) return true;
  if (
    hasHealth &&
    (norm.includes("system") ||
      norm.includes("check") ||
      norm.includes("report"))
  )
    return true;
  if (
    hasReadiness &&
    (norm.includes("status") ||
      norm.includes("report") ||
      norm.includes("check"))
  )
    return true;

  // Positive Persian patterns
  if (
    norm.includes("سلامت") &&
    (norm.includes("اپراتور") ||
      norm.includes("اوپراتور") ||
      norm.includes("سیستم") ||
      norm.includes("بررسی"))
  ) {
    return true;
  }

  if (
    norm.includes("آمادگی") &&
    (norm.includes("اپراتور") ||
      norm.includes("اوپراتور") ||
      norm.includes("سیستم") ||
      norm.includes("وضعیت"))
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
