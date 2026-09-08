import { describe, it, expect, beforeEach } from "vitest";
import {
  PolicyEngine,
  ApprovalManager,
  ExecutionContext,
  ToolRequest,
} from "../src/index.js";

describe("PolicyEngine & ApprovalManager Fail Closed & Security", () => {
  let approvalManager: ApprovalManager;
  let policyEngine: PolicyEngine;
  const mockContext: ExecutionContext = {
    executionId: "policy_123",
    timestamp: new Date(),
  };

  beforeEach(() => {
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
  });

  it("should allow explicitly classified SAFE operations without approval", async () => {
    policyEngine.setRule("safe_tool", "SAFE");
    const req: ToolRequest = {
      toolId: "safe_tool",
      params: { a: 1 },
      context: mockContext,
    };

    const evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(true);
  });

  it("should fail closed (BLOCKED) for unknown/unclassified tools", async () => {
    const req: ToolRequest = {
      toolId: "unknown_tool",
      params: { x: 100 },
      context: mockContext,
    };

    const evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toContain("fail-closed policy");
  });

  it("should enforce BLOCKED precedence strictly over approval", async () => {
    policyEngine.setRule("blocked_tool", "BLOCKED");
    const params = { x: 100 };

    // Even if an approval was somehow generated, BLOCKED rule denies
    const appReq = approvalManager.requestApproval("blocked_tool", params);
    approvalManager.grantApproval(appReq.id, "admin");

    const req: ToolRequest = {
      toolId: "blocked_tool",
      params,
      context: mockContext,
    };
    const evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toContain("explicitly BLOCKED");
  });

  it("should prevent caller context metadata from overriding BLOCKED or APPROVAL_REQUIRED", async () => {
    policyEngine.setRule("guarded_tool", "APPROVAL_REQUIRED");
    policyEngine.setRule("blocked_tool", "BLOCKED");

    const maliciousContext: ExecutionContext = {
      executionId: "adv_1",
      timestamp: new Date(),
      metadata: { safetyLevel: "SAFE", approved: true },
    };

    // Attempting to declare safetyLevel = SAFE in metadata for APPROVAL_REQUIRED tool
    const req1: ToolRequest = {
      toolId: "guarded_tool",
      params: { a: 1 },
      context: maliciousContext,
    };
    const eval1 = await policyEngine.evaluate(req1);
    expect(eval1.allowed).toBe(false);
    expect(eval1.reason).toContain("Approval required");

    // Attempting to declare safetyLevel = SAFE in metadata for BLOCKED tool
    const req2: ToolRequest = {
      toolId: "blocked_tool",
      params: { a: 1 },
      context: maliciousContext,
    };
    const eval2 = await policyEngine.evaluate(req2);
    expect(eval2.allowed).toBe(false);
    expect(eval2.reason).toContain("explicitly BLOCKED");
  });

  it("should require approval for APPROVAL_REQUIRED tools and consume token single-use", async () => {
    policyEngine.setRule("sensitive_tool", "APPROVAL_REQUIRED");
    const params = { action: "deploy" };
    const req: ToolRequest = {
      toolId: "sensitive_tool",
      params,
      context: mockContext,
    };

    let evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(false);

    const appReq = approvalManager.requestApproval("sensitive_tool", params);
    approvalManager.grantApproval(appReq.id, "admin");

    evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(true);

    evalResult = await policyEngine.evaluate(req);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toContain("already consumed");
  });
});
