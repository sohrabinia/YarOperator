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
