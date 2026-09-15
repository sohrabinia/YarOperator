import { AgentRegistry, RegisteredAgent } from "../agent/index.js";
import {
  BrainResult,
  BrainIntent,
  ExecutionContext,
} from "../contracts/index.js";
import { PolicyEngine } from "../policy/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { RealWorldAssistant, AssistantGoal } from "../assistant/index.js";

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
  constructor(
    private registry: AgentRegistry,
    private policyEngine?: PolicyEngine,
    private toolEcosystem?: SecureToolEcosystem,
    private assistant?: RealWorldAssistant,
  ) {}

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

    // 1. CONVERSATION Intent
    if (brainResult.intent === "CONVERSATION") {
      return {
        accepted: true,
        intent: "CONVERSATION",
        status: "CONVERSATION",
        reply: brainResult.reply || "سلام! در خدمتم. چه کاری برایتان انجام دهم؟",
        resolvedCapability: "conversation",
      };
    }

    // 2. AMBIGUOUS Intent
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

    // 3. ACTION Intent
    let capability = request.targetCapability || "software-development";
    let toolId = request.requestedToolId;

    if (!toolId) {
      const selectedAgent = this.selectAgentForCapability(
        capability,
        workspaceId,
      );
      if (!selectedAgent) {
        return {
          accepted: false,
          intent: "ACTION",
          status: "BLOCKED",
          reason: `No agent available for capability '${capability}' in workspace '${workspaceId}'.`,
        };
      }

      if (this.toolEcosystem) {
        const registry = this.toolEcosystem.getRegistry();
        const lowerPrompt = rawCommandText.toLowerCase();

        for (const tId of selectedAgent.toolScopes) {
          const toolObj = registry.get(tId);
          if (toolObj) {
            const nameLower = toolObj.metadata.name.toLowerCase();
            const descLower = toolObj.metadata.description.toLowerCase();
            const idLower = toolObj.metadata.id.toLowerCase();

            // Priority match for git / repo / repository / مخزن / ریپازیتوری
            if (
              (lowerPrompt.includes("git") ||
                lowerPrompt.includes("repo") ||
                lowerPrompt.includes("مخزن") ||
                lowerPrompt.includes("ریپازیتوری") ||
                lowerPrompt.includes("repository")) &&
              (idLower.includes("git") || descLower.includes("git"))
            ) {
              toolId = tId;
              break;
            }

            if (
              lowerPrompt.includes(idLower) ||
              lowerPrompt.includes("git") ||
              lowerPrompt.includes("terminal") ||
              lowerPrompt.includes(" status") ||
              lowerPrompt.includes("وضعیت") ||
              nameLower.includes("terminal") ||
              descLower.includes("terminal") ||
              descLower.includes("git")
            ) {
              toolId = tId;
              break;
            }
          }
        }
      }

      if (!toolId) {
        if (selectedAgent.toolScopes.length === 1) {
          toolId = selectedAgent.toolScopes[0];
        } else {
          return {
            accepted: false,
            intent: "ACTION",
            status: "BLOCKED",
            reason: `No suitable tool found for goal '${rawCommandText}' under capability '${capability}'. Ambiguous or unknown tool selection rejected.`,
          };
        }
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
          reason: `Tool '${toolId}' is not registered in ToolRegistry. Unknown capability/tool rejected.`,
        };
      }
    }

    const execContext: ExecutionContext = context || {
      executionId: `exec_${commandId}`,
      timestamp: new Date(),
      workspaceId,
      environmentId,
    };

    // If RealWorldAssistant is present, delegate execution to RealWorldAssistant workflow
    if (this.assistant) {
      if (this.policyEngine) {
        await this.policyEngine.evaluate({
          toolId,
          params,
          context: execContext,
        });
      }

      const goal: AssistantGoal = {
        id: commandId,
        workspaceId,
        environmentId,
        description: rawCommandText,
        targetCapability: capability,
        requestedToolId: toolId,
        params,
      };

      const astRes = await this.assistant.executeWorkflow(goal, execContext);

      if (astRes.success) {
        return {
          accepted: true,
          intent: "ACTION",
          status: "COMPLETED",
          resolvedCapability: capability,
          resolvedToolId: toolId,
          output: astRes.evidence,
        };
      } else {
        const stepStatus = astRes.executedSteps[0]?.status;
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
          error: astRes.error || "Execution failed in assistant runtime.",
        };
      }
    }

    // Direct Orchestrator path without RealWorldAssistant
    if (this.policyEngine) {
      const policyEval = await this.policyEngine.evaluate({
        toolId,
        params,
        context: execContext,
      });

      if (!policyEval.allowed) {
        const rule = this.policyEngine.getRule(toolId);
        const status =
          rule === "APPROVAL_REQUIRED" ? "APPROVAL_REQUIRED" : "BLOCKED";
        return {
          accepted: rule === "APPROVAL_REQUIRED",
          intent: "ACTION",
          status,
          resolvedCapability: capability,
          resolvedToolId: toolId,
          reason:
            policyEval.reason || `Execution blocked by policy (${status}).`,
        };
      }
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
}
