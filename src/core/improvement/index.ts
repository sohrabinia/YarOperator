import { PolicyEngine } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { ActionSafetyLevel } from "../contracts/index.js";

export type ProposalRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface OperationalOutcome {
  id: string;
  workspaceId: string;
  component: string;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface ImprovementProposal {
  id: string;
  workspaceId: string;
  reason: string;
  evidence: OperationalOutcome[];
  targetComponent: string;
  proposedChange: Record<string, unknown>;
  riskLevel: ProposalRiskLevel;
  attemptsPolicyEngineMutation?: boolean;
  status: "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED" | "BLOCKED";
  createdAt: string;
}

export class SelfImprovementEngine {
  private proposals: Map<string, ImprovementProposal> = new Map();

  constructor(
    private policyEngine: PolicyEngine,
    private auditManager?: AuditManager,
    private notificationManager?: NotificationManager,
  ) {}

  public generateProposal(
    workspaceId: string,
    reason: string,
    targetComponent: string,
    proposedChange: Record<string, unknown>,
    evidence: OperationalOutcome[],
    riskLevel: ProposalRiskLevel = "LOW",
  ): ImprovementProposal {
    const id = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // Check if proposal attempts to mutate PolicyEngine or Security Boundaries
    const attemptsPolicyEngineMutation =
      targetComponent.toLowerCase().includes("policy") ||
      targetComponent.toLowerCase().includes("authorization") ||
      targetComponent.toLowerCase().includes("permission") ||
      Boolean(proposedChange.mutatePolicyEngine) ||
      Boolean(proposedChange.bypassApproval);

    const proposal: ImprovementProposal = {
      id,
      workspaceId,
      reason,
      evidence,
      targetComponent,
      proposedChange,
      riskLevel,
      attemptsPolicyEngineMutation,
      status: attemptsPolicyEngineMutation ? "BLOCKED" : "PROPOSED",
      createdAt: now,
    };

    this.proposals.set(id, proposal);

    if (this.auditManager) {
      this.auditManager.recordEvent(
        "DECISION_MADE",
        {
          event: "IMPROVEMENT_PROPOSAL_GENERATED",
          proposalId: id,
          targetComponent,
          attemptsPolicyEngineMutation,
          riskLevel,
        },
        { workspaceId, taskId: id },
      );
    }

    if (attemptsPolicyEngineMutation) {
      if (this.notificationManager) {
        this.notificationManager.notify({
          workspaceId,
          taskId: id,
          type: "ESCALATION",
          priority: "URGENT",
          title: "Self-Improvement Policy Mutation Attempt Blocked",
          message: `Blocked proposal '${id}' targeting security boundary '${targetComponent}'.`,
        });
      }
    }

    return proposal;
  }

  public evaluateProposal(proposalId: string): {
    decision: ActionSafetyLevel;
    reason: string;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return {
        decision: "BLOCKED",
        reason: `Proposal ${proposalId} not found.`,
      };
    }

    // Absolute Security Boundary: Self-improvement CANNOT mutate PolicyEngine or permissions
    if (proposal.attemptsPolicyEngineMutation) {
      proposal.status = "BLOCKED";
      return {
        decision: "BLOCKED",
        reason:
          "Self-improvement is strictly forbidden from autonomously modifying PolicyEngine, permissions, or security boundaries.",
      };
    }

    if (proposal.riskLevel === "HIGH" || proposal.riskLevel === "CRITICAL") {
      return {
        decision: "APPROVAL_REQUIRED",
        reason: `High risk improvement proposal requires explicit owner approval.`,
      };
    }

    return {
      decision: "SAFE",
      reason: "Low risk improvement proposal authorized.",
    };
  }

  public applyProposal(proposalId: string): {
    success: boolean;
    proposal: ImprovementProposal;
    error?: string;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const evalResult = this.evaluateProposal(proposalId);

    if (evalResult.decision === "BLOCKED") {
      proposal.status = "BLOCKED";
      if (this.auditManager) {
        this.auditManager.recordEvent(
          "ACTION_FAILED",
          {
            event: "IMPROVEMENT_PROPOSAL_BLOCKED",
            proposalId,
            reason: evalResult.reason,
          },
          {
            workspaceId: proposal.workspaceId,
            taskId: proposalId,
            severity: "HIGH",
          },
        );
      }
      return { success: false, proposal, error: evalResult.reason };
    }

    if (
      evalResult.decision === "APPROVAL_REQUIRED" &&
      proposal.status !== "APPROVED"
    ) {
      if (this.notificationManager) {
        this.notificationManager.notify({
          workspaceId: proposal.workspaceId,
          taskId: proposalId,
          type: "APPROVAL_REQUIRED",
          priority: "HIGH",
          title: "High Risk Improvement Proposal Approval Required",
          message: `Proposal '${proposalId}' requires owner approval before applying.`,
        });
      }
      return { success: false, proposal, error: evalResult.reason };
    }

    proposal.status = "APPLIED";

    if (this.auditManager) {
      this.auditManager.recordEvent(
        "ACTION_COMPLETED",
        { event: "IMPROVEMENT_PROPOSAL_APPLIED", proposalId },
        { workspaceId: proposal.workspaceId, taskId: proposalId },
      );
    }

    if (this.notificationManager) {
      this.notificationManager.notify({
        workspaceId: proposal.workspaceId,
        taskId: proposalId,
        type: "TASK_COMPLETED",
        priority: "LOW",
        title: "Self-Improvement Applied",
        message: `Applied improvement proposal '${proposalId}' for '${proposal.targetComponent}'.`,
      });
    }

    return { success: true, proposal };
  }

  public getProposal(id: string): ImprovementProposal | undefined {
    return this.proposals.get(id);
  }
}
