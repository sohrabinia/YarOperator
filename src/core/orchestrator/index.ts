import { AgentRegistry, RegisteredAgent } from "../agent/index.js";
import { validateBrainPlan } from "../brain/index.js";
import {
  BrainResult,
  BrainIntent,
  ExecutionContext,
  BrainPlan,
  PlanExecutionResult,
  StepExecutionResult,
  StepExecutionState,
} from "../contracts/index.js";
import { PolicyEngine } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { RealWorldAssistant, AssistantGoal } from "../assistant/index.js";
import { CapabilityResolver } from "../capability/index.js";

export interface ExecutionScope {
  id: string;
  workspaceId: string;
  agentId: string;
  allowedCapabilities: string[];
  allowedTools: string[];
  maxRetries: number;
}

export interface OrchestrationRequest {
  brainResult: BrainResult;
  commandId: string;
  workspaceId: string;
  environmentId?: string;
  targetCapability?: string;
  requestedToolId?: string;
  params?: Record<string, unknown>;
  rawCommandText?: string;
}

export interface OrchestrationResult {
  accepted: boolean;
  intent: BrainIntent;
  status:
    | "CONVERSATION"
    | "AMBIGUOUS"
    | "SAFE"
    | "APPROVAL_REQUIRED"
    | "BLOCKED"
    | "COMPLETED"
    | "FAILED";
  reason?: string;
  reply?: string;
  resolvedCapability?: string;
  resolvedToolId?: string;
  output?: unknown;
  error?: string;
}

export class AgentOrchestrator {
  private capabilityResolver: CapabilityResolver;

  constructor(
    private registry: AgentRegistry,
    private policyEngine?: PolicyEngine,
    private toolEcosystem?: SecureToolEcosystem,
    private assistant?: RealWorldAssistant,
    capabilityResolver?: CapabilityResolver,
  ) {
    this.capabilityResolver =
      capabilityResolver || new CapabilityResolver(this.registry);
  }

  public setPolicyEngine(policyEngine: PolicyEngine): void {
    this.policyEngine = policyEngine;
  }

  public setToolEcosystem(toolEcosystem: SecureToolEcosystem): void {
    this.toolEcosystem = toolEcosystem;
  }

  public setAssistant(assistant: RealWorldAssistant): void {
    this.assistant = assistant;
  }

  selectAgentForCapability(
    capability: string,
    workspaceId: string,
  ): RegisteredAgent | undefined {
    const candidates = this.registry.findAgentsByCapability(
      capability,
      workspaceId,
    );
    return candidates[0];
  }

  createExecutionScope(params: {
    workspaceId: string;
    agentId: string;
    capabilities: string[];
    tools: string[];
    maxRetries?: number;
  }): ExecutionScope {
    return {
      id: `scope_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      allowedCapabilities: params.capabilities,
      allowedTools: params.tools,
      maxRetries: params.maxRetries ?? 3,
    };
  }

  async orchestrateBrainResult(
    request: OrchestrationRequest,
    context?: ExecutionContext,
  ): Promise<OrchestrationResult> {
    const {
      brainResult,
      commandId,
      workspaceId,
      environmentId,
      params = {},
      rawCommandText = "",
    } = request;

    // 1. CONVERSATION Intent -> Terminate immediately
    if (brainResult.intent === "CONVERSATION") {
      return {
        accepted: true,
        intent: "CONVERSATION",
        status: "CONVERSATION",
        reply:
          brainResult.reply || "سلام! در خدمتم. چه کاری برایتان انجام دهم؟",
        resolvedCapability: "conversation",
      };
    }

    // 2. AMBIGUOUS Intent -> Terminate immediately
    if (brainResult.intent === "AMBIGUOUS") {
      return {
        accepted: false,
        intent: "AMBIGUOUS",
        status: "AMBIGUOUS",
        reason:
          brainResult.reason ||
          "Input is ambiguous and requires clarification.",
      };
    }

    // 3. ACTION Intent Resolution via CapabilityResolver
    const capRes = this.capabilityResolver.resolve({
      brainResult,
      workspaceId,
      targetCapability: request.targetCapability,
      requestedToolId: request.requestedToolId,
      rawCommandText: request.rawCommandText,
    });

    if (capRes.status !== "RESOLVED" || !capRes.resolvedCapability) {
      return {
        accepted: false,
        intent: "ACTION",
        status: "BLOCKED",
        reason:
          capRes.reason ||
          "Capability resolution failed: Unknown or unsupported capability.",
      };
    }

    let capability = capRes.resolvedCapability;
    let toolId = capRes.resolvedToolId;

    if (!toolId) {
      const selectedAgent = this.selectAgentForCapability(
        capability,
        workspaceId,
      );
      if (!selectedAgent || selectedAgent.toolScopes.length === 0) {
        return {
          accepted: false,
          intent: "ACTION",
          status: "BLOCKED",
          reason: `No agent available for capability '${capability}' in workspace '${workspaceId}'.`,
        };
      }

      if (selectedAgent.toolScopes.length === 1) {
        toolId = selectedAgent.toolScopes[0];
      } else {
        return {
          accepted: false,
          intent: "ACTION",
          status: "BLOCKED",
          reason:
            "No explicit tool provided for action execution under multi-tool capability.",
        };
      }
    }

    // Verify capability/tool exists in registry
    if (this.toolEcosystem) {
      const registry = this.toolEcosystem.getRegistry();
      if (!registry.get(toolId)) {
        return {
          accepted: false,
          intent: "ACTION",
          status: "BLOCKED",
          resolvedCapability: capability,
          resolvedToolId: toolId,
          reason: `Tool '${toolId}' is not registered in ToolRegistry. Unknown tool rejected.`,
        };
      }
    }

    // Capability / Tool explicitly identified -> Check Policy Engine
    if (!this.policyEngine) {
      return {
        accepted: false,
        intent: "ACTION",
        status: "BLOCKED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        reason: "PolicyEngine unavailable to authorize capability execution.",
      };
    }

    let canonicalAction = (params as any)?.action
      ? `${toolId}:${(params as any).action}`
      : toolId;
    if (this.toolEcosystem) {
      const tool = this.toolEcosystem.getRegistry().get(toolId);
      if (tool && typeof tool.resolveCanonicalAction === "function") {
        canonicalAction = tool.resolveCanonicalAction(params);
      }
    }

    const resolvedEnvId =
      environmentId ||
      context?.environmentId ||
      (workspaceId ? `env_${workspaceId}` : "");

    // 1. Environment Boundary Check (FAIL-CLOSED)
    if (this.toolEcosystem) {
      const envManager = (this.toolEcosystem as any).environmentManager;
      if (envManager) {
        const envCheck = envManager.validateEnvironmentAccess(
          resolvedEnvId,
          workspaceId,
          toolId,
        );
        if (!envCheck.valid) {
          return {
            accepted: false,
            intent: "ACTION",
            status: "BLOCKED",
            resolvedCapability: capability,
            resolvedToolId: toolId,
            reason:
              envCheck.reason ||
              `Environment boundary check failed for environment '${resolvedEnvId}'.`,
          };
        }
      }
    }

    const execContext: ExecutionContext = context || {
      executionId: `exec_${commandId}`,
      timestamp: new Date(),
      workspaceId,
      environmentId: resolvedEnvId,
    };

    // 2. If RealWorldAssistant is present, delegate execution to RealWorldAssistant workflow
    if (this.assistant) {
      await this.policyEngine.evaluate({
        toolId,
        params,
        context: execContext,
      });

      const goal: AssistantGoal = {
        id: commandId,
        workspaceId,
        environmentId: resolvedEnvId,
        description: rawCommandText,
        targetCapability: capability,
        requestedToolId: toolId,
        params,
      };

      const astRes = await this.assistant.executeWorkflow(goal, execContext);

      if (astRes && astRes.success) {
        return {
          accepted: true,
          intent: "ACTION",
          status: "COMPLETED",
          resolvedCapability: capability,
          resolvedToolId: toolId,
          output: astRes.evidence,
        };
      } else {
        const stepStatus = astRes?.executedSteps?.[0]?.status;
        const status =
          stepStatus === "APPROVAL_REQUIRED"
            ? "APPROVAL_REQUIRED"
            : stepStatus === "BLOCKED"
              ? "BLOCKED"
              : "FAILED";

        return {
          accepted: status === "APPROVAL_REQUIRED",
          intent: "ACTION",
          status,
          resolvedCapability: capability,
          resolvedToolId: toolId,
          error: astRes?.error || "Execution failed in assistant runtime.",
        };
      }
    }

    // 3. Direct Orchestrator Execution Path (when Assistant is not present)
    const ruleLevel =
      this.policyEngine.resolveSafetyLevel(toolId, canonicalAction) ||
      "BLOCKED";

    if (ruleLevel === "BLOCKED") {
      return {
        accepted: false,
        intent: "ACTION",
        status: "BLOCKED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        reason: `Action '${canonicalAction}' is explicitly BLOCKED by PolicyEngine.`,
      };
    }

    if (ruleLevel === "APPROVAL_REQUIRED") {
      return {
        accepted: true,
        intent: "ACTION",
        status: "APPROVAL_REQUIRED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        reason: `Action '${canonicalAction}' requires explicit owner approval.`,
      };
    }

    if (!this.toolEcosystem) {
      return {
        accepted: false,
        intent: "ACTION",
        status: "BLOCKED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        reason: "SecureToolEcosystem unavailable to execute authorized tool.",
      };
    }

    const policyEval = await this.policyEngine.evaluate(
      {
        toolId,
        params,
        context: execContext,
      },
      canonicalAction,
    );

    if (!policyEval.allowed) {
      return {
        accepted: false,
        intent: "ACTION",
        status: "BLOCKED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        reason: policyEval.reason || "Execution blocked by PolicyEngine.",
      };
    }

    const agent = this.selectAgentForCapability(capability, workspaceId);
    const scope = this.createExecutionScope({
      workspaceId,
      agentId: agent?.id || "default_agent",
      capabilities: [capability],
      tools: [toolId],
    });

    try {
      const execResult = await this.toolEcosystem.execute(
        toolId,
        params,
        scope,
        execContext,
      );

      if (execResult.success) {
        return {
          accepted: true,
          intent: "ACTION",
          status: "COMPLETED",
          resolvedCapability: capability,
          resolvedToolId: toolId,
          output: execResult.output,
        };
      } else {
        return {
          accepted: false,
          intent: "ACTION",
          status: "FAILED",
          resolvedCapability: capability,
          resolvedToolId: toolId,
          error: execResult.error || "Tool execution failed.",
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        accepted: false,
        intent: "ACTION",
        status: "FAILED",
        resolvedCapability: capability,
        resolvedToolId: toolId,
        error: errorMsg,
      };
    }
  }

  async orchestratePlan(
    plan: BrainPlan,
    planContext: {
      commandId: string;
      workspaceId: string;
      environmentId?: string;
    },
    context?: ExecutionContext,
  ): Promise<PlanExecutionResult> {
    const valRes = validateBrainPlan(plan);
    if (!valRes.valid) {
      return {
        goal: plan?.goal || "Invalid Plan",
        success: false,
        status: "FAILED",
        executionOrder: [],
        stepResults: {},
        stoppedEarly: true,
        stopReason: `Plan validation failed: ${valRes.errors.join("; ")}`,
      };
    }

    const stepResults: Record<string, StepExecutionResult> = {};
    const stepStates = new Map<string, StepExecutionState>();
    const executionOrder: string[] = [];

    for (const step of plan.steps) {
      stepStates.set(step.id, "PENDING");
      stepResults[step.id] = {
        stepId: step.id,
        purpose: step.purpose,
        action: step.action,
        state: "PENDING",
      };
    }

    let stoppedEarly = false;
    let stopReason: string | undefined;

    while (true) {
      const readySteps = plan.steps.filter((step) => {
        if (stepStates.get(step.id) !== "PENDING") return false;
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        return step.dependsOn.every(
          (depId) => stepStates.get(depId) === "SUCCEEDED",
        );
      });

      if (readySteps.length === 0) {
        const pendingSteps = plan.steps.filter(
          (step) => stepStates.get(step.id) === "PENDING",
        );

        if (pendingSteps.length > 0) {
          stoppedEarly = true;

          for (const step of pendingSteps) {
            let blockingDepId: string | undefined;
            if (step.dependsOn) {
              blockingDepId = step.dependsOn.find((depId) => {
                const depState = stepStates.get(depId);
                return depState !== "SUCCEEDED";
              });
            }

            stepStates.set(step.id, "SKIPPED");
            stepResults[step.id] = {
              ...stepResults[step.id],
              state: "SKIPPED",
              reason: blockingDepId
                ? `Dependency '${blockingDepId}' did not complete successfully (state: ${stepStates.get(blockingDepId)}).`
                : "Unresolvable dependency resolution.",
              skippedDueToDependency: blockingDepId,
            };
          }

          if (!stopReason) {
            stopReason =
              "Execution stopped because one or more dependencies failed, were blocked, or required approval.";
          }
        }

        break;
      }

      let currentStepFailedOrBlocked = false;

      for (const currentStep of readySteps) {
        const currentState = stepStates.get(currentStep.id);
        if (currentState !== "PENDING" && currentState !== undefined) {
          continue;
        }

        stepStates.set(currentStep.id, "RUNNING");
        stepResults[currentStep.id].state = "RUNNING";

        // M8 MULTI-STEP ENVIRONMENT MANDATORY CHECK
        const envId = planContext.environmentId || context?.environmentId;

        if (!envId || typeof envId !== "string" || envId.trim().length === 0) {
          stepStates.set(currentStep.id, "FAILED");
          stepResults[currentStep.id] = {
            stepId: currentStep.id,
            purpose: currentStep.purpose,
            action: currentStep.action,
            state: "FAILED",
            error:
              "Missing mandatory environment context: environmentId is required for execution.",
          };
          stoppedEarly = true;
          stopReason = `Step '${currentStep.id}' failed: Missing mandatory environment context: environmentId is required for execution.`;
          currentStepFailedOrBlocked = true;
          break;
        }

        const accumulatedEvidence: Record<string, unknown> = {};
        for (const [sId, res] of Object.entries(stepResults)) {
          if (res.state === "SUCCEEDED" && res.output !== undefined) {
            accumulatedEvidence[sId] = res.output;
          }
        }

        const stepReq: OrchestrationRequest = {
          brainResult: {
            intent: "ACTION",
            actionGoal: currentStep.action,
          },
          commandId: `${planContext.commandId}_${currentStep.id}`,
          workspaceId: planContext.workspaceId,
          environmentId: envId,
          targetCapability: undefined,
          requestedToolId: currentStep.toolId,
          params: {
            ...(currentStep.params || {}),
            ...(Object.keys(accumulatedEvidence).length > 0
              ? { previousEvidence: accumulatedEvidence }
              : {}),
          },
          rawCommandText: currentStep.purpose,
        };

        const stepExecContext: ExecutionContext = {
          executionId: `exec_${planContext.commandId}_${currentStep.id}`,
          timestamp: context?.timestamp || new Date(),
          workspaceId: planContext.workspaceId,
          environmentId: envId,
          metadata: context?.metadata,
        };

        const orchRes = await this.orchestrateBrainResult(
          stepReq,
          stepExecContext,
        );

        executionOrder.push(currentStep.id);

        if (orchRes.status === "COMPLETED") {
          stepStates.set(currentStep.id, "SUCCEEDED");
          stepResults[currentStep.id] = {
            stepId: currentStep.id,
            purpose: currentStep.purpose,
            action: currentStep.action,
            state: "SUCCEEDED",
            resolvedCapability: orchRes.resolvedCapability,
            resolvedToolId: orchRes.resolvedToolId,
            output: orchRes.output,
          };
        } else if (orchRes.status === "APPROVAL_REQUIRED") {
          stepStates.set(currentStep.id, "APPROVAL_REQUIRED");
          stepResults[currentStep.id] = {
            stepId: currentStep.id,
            purpose: currentStep.purpose,
            action: currentStep.action,
            state: "APPROVAL_REQUIRED",
            resolvedCapability: orchRes.resolvedCapability,
            resolvedToolId: orchRes.resolvedToolId,
            reason: orchRes.reason || "Step requires owner approval.",
          };
          stoppedEarly = true;
          stopReason = `Step '${currentStep.id}' requires approval.`;
          currentStepFailedOrBlocked = true;
          break;
        } else if (orchRes.status === "BLOCKED") {
          stepStates.set(currentStep.id, "BLOCKED");
          stepResults[currentStep.id] = {
            stepId: currentStep.id,
            purpose: currentStep.purpose,
            action: currentStep.action,
            state: "BLOCKED",
            resolvedCapability: orchRes.resolvedCapability,
            resolvedToolId: orchRes.resolvedToolId,
            reason:
              orchRes.reason ||
              "Step was blocked by policy or capability resolution.",
          };
          stoppedEarly = true;
          stopReason = `Step '${currentStep.id}' was blocked: ${orchRes.reason || "Policy or capability failure"}`;
          currentStepFailedOrBlocked = true;
          break;
        } else {
          stepStates.set(currentStep.id, "FAILED");
          stepResults[currentStep.id] = {
            stepId: currentStep.id,
            purpose: currentStep.purpose,
            action: currentStep.action,
            state: "FAILED",
            resolvedCapability: orchRes.resolvedCapability,
            resolvedToolId: orchRes.resolvedToolId,
            error: orchRes.error || orchRes.reason || "Step execution failed.",
          };
          stoppedEarly = true;
          stopReason = `Step '${currentStep.id}' failed: ${orchRes.error || orchRes.reason || "Execution failed"}`;
          currentStepFailedOrBlocked = true;
          break;
        }
      }

      if (currentStepFailedOrBlocked) {
        const remainingPending = plan.steps.filter(
          (step) => stepStates.get(step.id) === "PENDING",
        );
        for (const step of remainingPending) {
          let blockingDepId: string | undefined;
          if (step.dependsOn) {
            blockingDepId = step.dependsOn.find((depId) => {
              const depState = stepStates.get(depId);
              return depState !== "SUCCEEDED";
            });
          }

          stepStates.set(step.id, "SKIPPED");
          stepResults[step.id] = {
            ...stepResults[step.id],
            state: "SKIPPED",
            reason: blockingDepId
              ? `Prerequisite step '${blockingDepId}' did not succeed.`
              : "Execution stopped early due to earlier step failure.",
            skippedDueToDependency: blockingDepId,
          };
        }
        break;
      }
    }

    const allSucceeded = plan.steps.every(
      (step) => stepStates.get(step.id) === "SUCCEEDED",
    );

    if (allSucceeded) {
      return {
        goal: plan.goal,
        success: true,
        status: "COMPLETED",
        executionOrder,
        stepResults,
        stoppedEarly: false,
      };
    }

    const anySucceeded = plan.steps.some(
      (step) => stepStates.get(step.id) === "SUCCEEDED",
    );

    const hasBlocked = plan.steps.some(
      (step) => stepStates.get(step.id) === "BLOCKED",
    );

    const hasApproval = plan.steps.some(
      (step) => stepStates.get(step.id) === "APPROVAL_REQUIRED",
    );

    const overallStatus = anySucceeded
      ? "PARTIAL"
      : hasBlocked
        ? "BLOCKED"
        : hasApproval
          ? "APPROVAL_REQUIRED"
          : "FAILED";

    return {
      goal: plan.goal,
      success: false,
      status: overallStatus,
      executionOrder,
      stepResults,
      stoppedEarly: true,
      stopReason: stopReason || "Plan execution did not complete successfully.",
    };
  }
}
