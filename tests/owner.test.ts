import { describe, it, expect, beforeEach } from "vitest";
import {
  OwnerManager,
  PolicyEngine,
  ApprovalManager,
  ExecutionContext,
  ToolRequest,
} from "../src/index.js";

describe("OwnerManager & Preference Model", () => {
  let ownerManager: OwnerManager;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  const mockContext: ExecutionContext = {
    executionId: "owner_ctx_1",
    timestamp: new Date(),
  };

  beforeEach(() => {
    ownerManager = new OwnerManager();
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
  });

  it("should create and retrieve owner profile", () => {
    const profile = ownerManager.createProfile({
      id: "owner_1",
      name: "Owner Name",
      defaultWorkspaceId: "yartrader",
    });

    expect(profile.id).toBe("owner_1");
    expect(profile.name).toBe("Owner Name");
    expect(ownerManager.getProfile()?.defaultWorkspaceId).toBe("yartrader");
  });

  it("should initialize default preferences and allow updates", () => {
    const prefs = ownerManager.getPreferences();
    expect(prefs.communication.notificationPreference).toBe("BATCHED");
    expect(prefs.riskTolerance).toBe("LOW");

    const updated = ownerManager.updatePreferences({
      riskTolerance: "MEDIUM",
      communication: {
        notificationPreference: "IMMEDIATE",
        interruptionTolerance: "HIGH",
      },
    });

    expect(updated.riskTolerance).toBe("MEDIUM");
    expect(updated.communication.notificationPreference).toBe("IMMEDIATE");
  });

  it("should evaluate default approval rules and custom category rules", () => {
    expect(ownerManager.requiresApproval("INFORMATIONAL")).toBe(false);
    expect(ownerManager.requiresApproval("DEVELOPMENT")).toBe(false);
    expect(ownerManager.requiresApproval("PRODUCTION_CHANGE")).toBe(true);
    expect(ownerManager.requiresApproval("FINANCIAL")).toBe(true);

    ownerManager.setApprovalRule("DEVELOPMENT", true);
    expect(ownerManager.requiresApproval("DEVELOPMENT")).toBe(true);
  });

  it("should verify that owner preferences CANNOT bypass PolicyEngine BLOCKED decisions", async () => {
    policyEngine.setRule("blocked_tool", "BLOCKED");

    // Owner sets high risk tolerance and full autonomy preference
    ownerManager.updatePreferences({
      riskTolerance: "HIGH",
      preferredAutonomyLevel: "FULL_AUTONOMOUS",
    });

    const req: ToolRequest = {
      toolId: "blocked_tool",
      params: {},
      context: mockContext,
    };

    const evalResult = await policyEngine.evaluate(req);

    // Security invariant: Owner preference cannot bypass PolicyEngine BLOCKED rule
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toContain("explicitly BLOCKED");
  });
});
