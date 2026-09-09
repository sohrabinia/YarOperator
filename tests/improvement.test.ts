import { describe, it, expect, beforeEach } from "vitest";
import {
  SelfImprovementEngine,
  OperationalOutcome,
} from "../src/core/improvement/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";

describe("Phase 30 — Self Improvement Loop", () => {
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let improvementEngine: SelfImprovementEngine;

  beforeEach(() => {
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();

    improvementEngine = new SelfImprovementEngine(
      policyEngine,
      auditManager,
      notificationManager,
    );
  });

  it("1. Low risk proposal is evaluated as SAFE and applied successfully", () => {
    const evidence: OperationalOutcome[] = [
      {
        id: "out_1",
        workspaceId: "yartrader",
        component: "orchestrator",
        success: true,
        timestamp: new Date().toISOString(),
      },
    ];

    const prop = improvementEngine.generateProposal(
      "yartrader",
      "Optimize agent capability routing cache",
      "orchestrator",
      { cacheTTLMs: 60000 },
      evidence,
      "LOW",
    );

    expect(prop.status).toBe("PROPOSED");

    const result = improvementEngine.applyProposal(prop.id);
    expect(result.success).toBe(true);
    expect(result.proposal.status).toBe("APPLIED");
  });

  it("2. High risk proposal evaluates to APPROVAL_REQUIRED and cannot apply without approval", () => {
    const evidence: OperationalOutcome[] = [
      {
        id: "out_2",
        workspaceId: "yartrader",
        component: "workflow",
        success: false,
        errorMessage: "Workflow timeout under high load",
        timestamp: new Date().toISOString(),
      },
    ];

    const prop = improvementEngine.generateProposal(
      "yartrader",
      "Increase global workflow execution concurrency limit",
      "workflow",
      { maxConcurrency: 50 },
      evidence,
      "HIGH",
    );

    const result = improvementEngine.applyProposal(prop.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("approval");

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
      taskId: prop.id,
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("APPROVAL_REQUIRED");
  });

  it("3. Proposal attempting PolicyEngine mutation is BLOCKED immediately (Absolute Security Boundary)", () => {
    const evidence: OperationalOutcome[] = [];

    const prop = improvementEngine.generateProposal(
      "yartrader",
      "Bypass PolicyEngine rule for deployment tool",
      "PolicyEngine", // Target security boundary
      { mutatePolicyEngine: true },
      evidence,
      "CRITICAL",
    );

    expect(prop.status).toBe("BLOCKED");
    expect(prop.attemptsPolicyEngineMutation).toBe(true);

    const evalRes = improvementEngine.evaluateProposal(prop.id);
    expect(evalRes.decision).toBe("BLOCKED");
    expect(evalRes.reason).toContain("strictly forbidden");

    const applyRes = improvementEngine.applyProposal(prop.id);
    expect(applyRes.success).toBe(false);
    expect(applyRes.proposal.status).toBe("BLOCKED");

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
      taskId: prop.id,
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("ESCALATION");
  });
});
