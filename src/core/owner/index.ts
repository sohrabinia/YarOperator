import { AuditManager } from "../audit/index.js";
import { PolicyEngine } from "../policy/index.js";
import {
  RealWorldAssistant,
  AssistantWorkflowResult,
} from "../assistant/index.js";
import { ExecutionContext, Brain, BrainInput } from "../contracts/index.js";
import { DeterministicBrain } from "../brain/index.js";
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
  private authorizedEmailMap = new Map<string, string>([
    ["m.a.sohrabinia@gmail.com", "owner_sohrab"],
  ]);
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

  registerAuthorizedEmail(email: string, ownerId: string): void {
    this.authorizedEmailMap.set(email.toLowerCase(), ownerId);
  }

  getOwnerIdForEmail(email: string): string | undefined {
    return this.authorizedEmailMap.get(email.toLowerCase());
  }

  isEmailAuthorized(email: string): boolean {
    return this.authorizedEmailMap.has(email.toLowerCase());
  }
}

export type CommandIntent = "CONVERSATION" | "ACTION";

export interface IntentClassificationResult {
  intent: CommandIntent;
  reply?: string;
}

export class IntentBoundary {
  public static classify(input: {
    rawCommandText: string;
    targetCapability?: string;
    requestedToolId?: string;
  }): IntentClassificationResult {
    const brain = new DeterministicBrain();
    const result = brain.interpret({ rawCommandText: input.rawCommandText });

    if (result.intent === "CONVERSATION") {
      return {
        intent: "CONVERSATION",
        reply: result.reply,
      };
    }

    return {
      intent: "ACTION",
    };
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
    private brain: Brain = new DeterministicBrain(),
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

    // 5. Brain Interpretation
    const brainInput: BrainInput = {
      rawCommandText: preservedText,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
    };

    const brainResult = await this.brain.interpret(brainInput);

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
          brainResult,
        },
        { workspaceId: input.workspaceId, taskId: input.commandId },
      );
      auditEventId = evt.id;
    }

    // Wire dependencies into orchestrator
    if (this.orchestrator) {
      if (this.policyEngine) {
        this.orchestrator.setPolicyEngine(this.policyEngine);
      }
      if (this.toolEcosystem) {
        this.orchestrator.setToolEcosystem(this.toolEcosystem);
      }
      if (this.assistant) {
        this.orchestrator.setAssistant(this.assistant);
      }
    }

    // 6. Route through Orchestrator
    if (!this.orchestrator) {
      return {
        commandId: input.commandId,
        accepted: false,
        reason: "No AgentOrchestrator available to orchestrate intent.",
        commandTextPreserved: preservedText,
        auditEventId,
      };
    }

    const orchResult = await this.orchestrator.orchestrateBrainResult(
      {
        brainResult,
        commandId: input.commandId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        targetCapability: input.targetCapability,
        requestedToolId: input.requestedToolId,
        params: input.params,
        rawCommandText: preservedText,
      },
      context,
    );

    // 7. Map Orchestrator Result -> OwnerCommandResult
    if (orchResult.intent === "CONVERSATION") {
      return {
        commandId: input.commandId,
        accepted: true,
        commandTextPreserved: preservedText,
        resolvedCapability: "conversation",
        resolvedToolId: undefined,
        auditEventId,
        assistantResult: {
          goalId: input.commandId,
          workspaceId: input.workspaceId,
          success: true,
          executedSteps: [],
          evidence: {
            summary:
              orchResult.reply || "سلام، در خدمتم. چه کاری برایت انجام بدهم؟",
          },
        },
      };
    }

    if (orchResult.intent === "AMBIGUOUS") {
      return {
        commandId: input.commandId,
        accepted: false,
        reason:
          orchResult.reason || "Input is ambiguous and requires clarification.",
        commandTextPreserved: preservedText,
        auditEventId,
      };
    }

    // ACTION Intent
    const isSuccess = orchResult.status === "COMPLETED";
    const stepStatus =
      orchResult.status === "COMPLETED"
        ? "EXECUTED"
        : orchResult.status === "APPROVAL_REQUIRED"
          ? "APPROVAL_REQUIRED"
          : orchResult.status === "BLOCKED"
            ? "BLOCKED"
            : "FAILED";

    const policyDecision =
      stepStatus === "EXECUTED"
        ? "SAFE"
        : stepStatus === "APPROVAL_REQUIRED"
          ? "APPROVAL_REQUIRED"
          : "BLOCKED";

    return {
      commandId: input.commandId,
      accepted: true,
      reason: orchResult.reason,
      commandTextPreserved: preservedText,
      resolvedCapability: orchResult.resolvedCapability,
      resolvedToolId: orchResult.resolvedToolId,
      auditEventId,
      assistantResult: {
        goalId: input.commandId,
        workspaceId: input.workspaceId,
        success: isSuccess,
        executedSteps: [
          {
            stepId: `step_${input.commandId}_1`,
            toolId: orchResult.resolvedToolId || "",
            params: input.params || {},
            policyDecision,
            status: stepStatus,
            result: orchResult.output,
            error: orchResult.error || orchResult.reason,
          },
        ],
        evidence: (orchResult.output as Record<string, unknown>) || undefined,
        error: orchResult.error || orchResult.reason,
      },
    };
  }
}
