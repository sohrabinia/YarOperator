import { AuditManager } from "../audit/index.js";
import { PolicyEngine } from "../policy/index.js";
import {
  RealWorldAssistant,
  AssistantGoal,
  AssistantWorkflowResult,
} from "../assistant/index.js";
import { ExecutionContext } from "../contracts/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { SecureToolEcosystem } from "../tools/index.js";

export type CommunicationNotificationPreference =
  "IMMEDIATE" | "BATCHED" | "SILENT";
export type InterruptionTolerance = "LOW" | "MEDIUM" | "HIGH";

export interface CommunicationPreferences {
  notificationPreference: CommunicationNotificationPreference;
  interruptionTolerance: InterruptionTolerance;
}

export type OperationalPreferenceLevel = "LOW" | "BALANCED" | "HIGH";

export interface OperationalPreferences {
  costPreference: OperationalPreferenceLevel;
  speedPreference: OperationalPreferenceLevel;
  qualityPreference: OperationalPreferenceLevel;
  privacyPreference: OperationalPreferenceLevel;
}

export type AutonomyLevelPreference =
  "ASSISTANT" | "SEMI_AUTONOMOUS" | "FULL_AUTONOMOUS";
export type RiskTolerance = "LOW" | "MEDIUM" | "HIGH";

export interface PreferenceModel {
  communication: CommunicationPreferences;
  operations: OperationalPreferences;
  preferredAutonomyLevel: AutonomyLevelPreference;
  riskTolerance: RiskTolerance;
}

export type OperationCategory =
  | "INFORMATIONAL"
  | "DEVELOPMENT"
  | "PRODUCTION_CHANGE"
  | "EXTERNAL_COMMUNICATION"
  | "FINANCIAL"
  | "DESTRUCTIVE";

export interface ApprovalRule {
  category: OperationCategory;
  requiresOwnerApproval: boolean;
}

export interface OwnerProfile {
  id: string;
  name: string;
  defaultWorkspaceId?: string;
  createdAt: Date;
}

export interface OwnerCommandInput {
  commandId: string;
  ownerId: string;
  workspaceId: string;
  environmentId?: string;
  rawCommandText: string;
  targetCapability?: string;
  requestedToolId?: string;
  params?: Record<string, unknown>;
  timestamp: string;
}

export interface OwnerCommandResult {
  commandId: string;
  accepted: boolean;
  reason?: string;
  commandTextPreserved: string;
  resolvedCapability?: string;
  resolvedToolId?: string;
  auditEventId?: string;
  assistantResult?: AssistantWorkflowResult;
}

export class OwnerManager {
  private profile?: OwnerProfile;
  private preferences: PreferenceModel = {
    communication: {
      notificationPreference: "BATCHED",
      interruptionTolerance: "LOW",
    },
    operations: {
      costPreference: "BALANCED",
      speedPreference: "BALANCED",
      qualityPreference: "HIGH",
      privacyPreference: "HIGH",
    },
    preferredAutonomyLevel: "ASSISTANT",
    riskTolerance: "LOW",
  };
  private approvalRules = new Map<OperationCategory, boolean>([
    ["INFORMATIONAL", false],
    ["DEVELOPMENT", false],
    ["PRODUCTION_CHANGE", true],
    ["EXTERNAL_COMMUNICATION", true],
    ["FINANCIAL", true],
    ["DESTRUCTIVE", true],
  ]);

  createProfile(params: {
    id: string;
    name: string;
    defaultWorkspaceId?: string;
  }): OwnerProfile {
    this.profile = {
      id: params.id,
      name: params.name,
      defaultWorkspaceId: params.defaultWorkspaceId,
      createdAt: new Date(),
    };
    return this.profile;
  }

  getProfile(): OwnerProfile | undefined {
    return this.profile;
  }

  getPreferences(): PreferenceModel {
    return { ...this.preferences };
  }

  updatePreferences(updates: Partial<PreferenceModel>): PreferenceModel {
    this.preferences = {
      ...this.preferences,
      ...updates,
      communication: {
        ...this.preferences.communication,
        ...updates.communication,
      },
      operations: {
        ...this.preferences.operations,
        ...updates.operations,
      },
    };
    return this.getPreferences();
  }

  setApprovalRule(
    category: OperationCategory,
    requiresApproval: boolean,
  ): void {
    this.approvalRules.set(category, requiresApproval);
  }

  requiresApproval(category: OperationCategory): boolean {
    return this.approvalRules.get(category) ?? true;
  }
}

export class OwnerCommandReceiver {
  constructor(
    private ownerManager: OwnerManager,
    private policyEngine: PolicyEngine,
    private auditManager?: AuditManager,
    private assistant?: RealWorldAssistant,
    private orchestrator?: AgentOrchestrator,
    private toolEcosystem?: SecureToolEcosystem,
  ) {}

  public async receiveCommand(
    input: OwnerCommandInput,
    context?: ExecutionContext,
  ): Promise<OwnerCommandResult> {
    // 1. Fail Closed on missing owner context
    if (!input.ownerId || input.ownerId.trim().length === 0) {
      return {
        commandId: input.commandId || "cmd_invalid",
        accepted: false,
        reason: "Missing owner context: ownerId is required.",
        commandTextPreserved: input.rawCommandText || "",
      };
    }

    // 2. Verify Owner Profile
    const activeProfile = this.ownerManager.getProfile();
    if (activeProfile && activeProfile.id !== input.ownerId) {
      return {
        commandId: input.commandId,
        accepted: false,
        reason: `Owner context mismatch: Command owner '${input.ownerId}' does not match registered owner profile '${activeProfile.id}'.`,
        commandTextPreserved: input.rawCommandText,
      };
    }

    // 3. Fail Closed on missing workspace context
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      return {
        commandId: input.commandId,
        accepted: false,
        reason: "Missing workspace context: workspaceId is required.",
        commandTextPreserved: input.rawCommandText,
      };
    }

    // 4. Fail Closed on malformed or empty command text
    if (!input.rawCommandText || input.rawCommandText.trim().length === 0) {
      return {
        commandId: input.commandId,
        accepted: false,
        reason: "Malformed or empty command text received.",
        commandTextPreserved: "",
      };
    }

    // Preserved command text (Unicode & Persian text supported)
    const preservedText = input.rawCommandText;

    // Resolve capability & tool from natural language goal
    let resolvedCapability = input.targetCapability || "software-development";
    let resolvedToolId = input.requestedToolId;

    if (!resolvedToolId) {
      if (!this.orchestrator) {
        return {
          commandId: input.commandId,
          accepted: false,
          reason: "No AgentOrchestrator available to resolve goal capability.",
          commandTextPreserved: preservedText,
        };
      }

      const selectedAgent = this.orchestrator.selectAgentForCapability(
        resolvedCapability,
        input.workspaceId,
      );

      if (!selectedAgent) {
        return {
          commandId: input.commandId,
          accepted: false,
          reason: `No suitable agent found for capability '${resolvedCapability}' in workspace '${input.workspaceId}'.`,
          commandTextPreserved: preservedText,
        };
      }

      // Semantic/Metadata tool matching against agent's authorized toolScopes
      if (this.toolEcosystem) {
        const registry = this.toolEcosystem.getRegistry();
        const lowerPrompt = preservedText.toLowerCase();

        for (const toolId of selectedAgent.toolScopes) {
          const toolObj = registry.get(toolId);
          if (toolObj) {
            const nameLower = toolObj.metadata.name.toLowerCase();
            const descLower = toolObj.metadata.description.toLowerCase();
            const idLower = toolObj.metadata.id.toLowerCase();

            // Match keywords in raw prompt against tool ID, name, or description
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
              resolvedToolId = toolId;
              break;
            }
          }
        }
      }

      // If toolEcosystem not provided or metadata match not found, fail closed if scope has multiple tools
      if (!resolvedToolId) {
        if (selectedAgent.toolScopes.length === 1) {
          resolvedToolId = selectedAgent.toolScopes[0];
        } else {
          return {
            commandId: input.commandId,
            accepted: false,
            reason: `No suitable tool found for goal '${preservedText}' under capability '${resolvedCapability}'. Ambiguous tool selection rejected.`,
            commandTextPreserved: preservedText,
          };
        }
      }
    }

    // Record audit event for intake
    let auditEventId: string | undefined;
    if (this.auditManager) {
      const evt = await this.auditManager.recordEvent(
        "ACTION_STARTED",
        {
          event: "OWNER_COMMAND_RECEIVED",
          commandId: input.commandId,
          ownerId: input.ownerId,
          workspaceId: input.workspaceId,
          environmentId: input.environmentId,
          rawCommandText: preservedText,
          resolvedCapability,
          resolvedToolId,
        },
        { workspaceId: input.workspaceId, taskId: input.commandId },
      );
      auditEventId = evt.id;
    }

    // Forward goal to RealWorldAssistant runtime if available
    let assistantResult: AssistantWorkflowResult | undefined;
    if (this.assistant && resolvedToolId) {
      const goal: AssistantGoal = {
        id: input.commandId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        description: preservedText,
        targetCapability: resolvedCapability,
        requestedToolId: resolvedToolId,
        params: input.params || {},
      };

      const execContext: ExecutionContext = context || {
        executionId: `exec_${input.commandId}`,
        timestamp: new Date(),
      };

      assistantResult = await this.assistant.executeWorkflow(goal, execContext);
    }

    return {
      commandId: input.commandId,
      accepted: true,
      commandTextPreserved: preservedText,
      resolvedCapability,
      resolvedToolId,
      auditEventId,
      assistantResult,
    };
  }
}
