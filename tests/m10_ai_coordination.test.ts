import { describe, it, expect, beforeEach } from "vitest";
import { IdentityStore } from "../src/core/identity/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager, InMemoryAuditStore } from "../src/core/audit/index.js";
import {
  ExternalAICoordinator,
  ExternalAIProvider,
  ExternalAIDelegationRequest,
  ExternalAIRawResult,
} from "../src/core/coordination/index.js";

class MockAIProvider implements ExternalAIProvider {
  public executeCallCount = 0;
  public lastReceivedSignal?: AbortSignal;
  public lastReceivedRequest?: ExternalAIDelegationRequest;

  constructor(
    public id: string = "mock_ai_provider",
    public name: string = "Mock AI Provider",
    private handler?: (
      req: ExternalAIDelegationRequest,
      signal?: AbortSignal,
    ) => Promise<ExternalAIRawResult>,
  ) {}

  async execute(
    request: ExternalAIDelegationRequest,
    signal?: AbortSignal,
  ): Promise<ExternalAIRawResult> {
    this.executeCallCount++;
    this.lastReceivedRequest = request;
    this.lastReceivedSignal = signal;

    if (this.handler) {
      return this.handler(request, signal);
    }

    return {
      success: true,
      taskId: request.id,
      workspaceId: request.workspaceId,
      output: { summary: "Delegated task analysis complete" },
    };
  }
}

describe("M10 External AI Coordination Security & Regression Test Suite", () => {
  let identityStore: IdentityStore;
  let policyEngine: PolicyEngine;
  let approvalManager: ApprovalManager;
  let auditManager: AuditManager;
  let coordinator: ExternalAICoordinator;
  let ownerUser: any;
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    identityStore = new IdentityStore(":memory:");
    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    auditManager = new AuditManager(new InMemoryAuditStore());

    ownerUser = identityStore.createUser({
      primaryEmail: "owner@yartrader.com",
      displayName: "Owner User",
    });

    identityStore.createWorkspace({
      workspaceId: "ws_m10",
      name: "M10 Workspace",
      ownerUserId: ownerUser.userId,
    });

    coordinator = new ExternalAICoordinator(
      identityStore,
      policyEngine,
      approvalManager,
      auditManager,
    );

    mockProvider = new MockAIProvider("mock_ai_provider");
    coordinator.registerProvider(mockProvider);
  });

  describe("1. Identity Authority", () => {
    it("permits delegation for valid owner and active workspace member", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_id_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Analyze repository code structure",
        requestedCapability: "ai-code-analysis",
        input: { repo: "sohrabinia/YarOperator" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("SUCCEEDED");
      expect(record.verificationStatus).toBe("PASSED");
      expect(record.result).toEqual({
        summary: "Delegated task analysis complete",
      });
    });

    it("fails closed (BLOCKED) for unknown or disabled owner", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_id_002",
        ownerId: "usr_unknown_stranger",
        workspaceId: "ws_m10",
        purpose: "Analyze repository code structure",
        requestedCapability: "ai-code-analysis",
        input: { repo: "sohrabinia/YarOperator" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain("does not exist or is disabled");
      expect(mockProvider.executeCallCount).toBe(0);
    });

    it("fails closed (BLOCKED) when owner is not an active workspace member", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const otherUser = identityStore.createUser({
        primaryEmail: "other@example.com",
      });

      const req: ExternalAIDelegationRequest = {
        id: "task_id_003",
        ownerId: otherUser.userId,
        workspaceId: "ws_m10",
        purpose: "Unauthorized workspace access attempt",
        requestedCapability: "ai-code-analysis",
        input: { repo: "sohrabinia/YarOperator" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain(
        "not an active member of workspace",
      );
      expect(mockProvider.executeCallCount).toBe(0);
    });

    it("fails closed (BLOCKED) when ownerId or workspaceId is missing", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_id_004",
        ownerId: "",
        workspaceId: "ws_m10",
        purpose: "Missing owner",
        requestedCapability: "ai-code-analysis",
        input: "test",
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain("Missing required ownerId");
    });
  });

  describe("2. Authorization Boundary", () => {
    it("automatically dispatches SAFE capability", async () => {
      policyEngine.setRule("ai-text-summarize", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_auth_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Summarize text",
        requestedCapability: "ai-text-summarize",
        input: { text: "Hello world" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("SUCCEEDED");
      expect(mockProvider.executeCallCount).toBe(1);
    });

    it("pauses execution for APPROVAL_REQUIRED capability", async () => {
      policyEngine.setRule("ai-code-mutation", "APPROVAL_REQUIRED");

      const req: ExternalAIDelegationRequest = {
        id: "task_auth_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Suggest code mutation",
        requestedCapability: "ai-code-mutation",
        input: { file: "src/index.ts" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("APPROVAL_REQUIRED");
      expect(record.approvalFingerprint).toBeDefined();
      expect(mockProvider.executeCallCount).toBe(0);
    });

    it("never dispatches explicitly BLOCKED capability", async () => {
      policyEngine.setRule("ai-admin-grant", "BLOCKED");

      const req: ExternalAIDelegationRequest = {
        id: "task_auth_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Attempt privileged grant",
        requestedCapability: "ai-admin-grant",
        input: { targetRole: "ADMIN" },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(mockProvider.executeCallCount).toBe(0);
    });

    it("fails closed (BLOCKED) for unknown/unclassified capability", async () => {
      const req: ExternalAIDelegationRequest = {
        id: "task_auth_004",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Execute unclassified capability",
        requestedCapability: "unknown-random-cap",
        input: {},
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.rejectionReason).toContain("unclassified or ambiguous");
      expect(mockProvider.executeCallCount).toBe(0);
    });
  });

  describe("3. Provider Abstraction", () => {
    it("handles provider failure gracefully with FAILED status", async () => {
      policyEngine.setRule("ai-failing-cap", "SAFE");

      const failProvider = new MockAIProvider(
        "failing_provider",
        "Failing AI",
        async () => ({
          success: false,
          error: "AI service internal model overflow",
        }),
      );
      coordinator.registerProvider(failProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_prov_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Failing request",
        requestedCapability: "ai-failing-cap",
        input: {},
        providerId: "failing_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("FAILED");
      expect(record.verificationStatus).toBe("FAILED");
      expect(record.error).toBe("AI service internal model overflow");
    });

    it("handles provider timeout cleanly", async () => {
      policyEngine.setRule("ai-slow-cap", "SAFE");

      const slowProvider = new MockAIProvider(
        "slow_provider",
        "Slow AI",
        async (_req, signal) => {
          return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
              resolve({ success: true, output: "too late" });
            }, 500);

            if (signal) {
              signal.addEventListener("abort", () => {
                clearTimeout(t);
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              });
            }
          });
        },
      );
      coordinator.registerProvider(slowProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_prov_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Slow task",
        requestedCapability: "ai-slow-cap",
        input: {},
        providerId: "slow_provider",
        timeoutMs: 50, // fast timeout
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("TIMED_OUT");
      expect(record.verificationStatus).toBe("FAILED");
      expect(record.error).toContain("timed out");
    });

    it("fails closed if requested provider is not registered", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_prov_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Unknown provider test",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "non_existent_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("BLOCKED");
      expect(record.rejectionReason).toContain("not registered or unavailable");
    });

    it("executes bounded retries when provider transient error occurs", async () => {
      policyEngine.setRule("ai-retry-cap", "SAFE");

      let attempt = 0;
      const retryProvider = new MockAIProvider(
        "retry_provider",
        "Retry AI",
        async (r) => {
          attempt++;
          if (attempt === 1) {
            throw new Error("Network glitch");
          }
          return {
            success: true,
            taskId: r.id,
            workspaceId: r.workspaceId,
            output: "Success on retry",
          };
        },
      );
      coordinator.registerProvider(retryProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_prov_004",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Retry request",
        requestedCapability: "ai-retry-cap",
        input: {},
        providerId: "retry_provider",
        maxRetries: 1,
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("SUCCEEDED");
      expect(record.retryCount).toBe(1);
      expect(record.result).toBe("Success on retry");
    });
  });

  describe("4. Untrusted Result Trust Boundary", () => {
    it("rejects result with mismatched taskId", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const spoofProvider = new MockAIProvider(
        "spoof_provider",
        "Spoof AI",
        async () => ({
          success: true,
          taskId: "WRONG_TASK_ID_SPOOF",
          workspaceId: "ws_m10",
          output: "Legitimate looking data",
        }),
      );
      coordinator.registerProvider(spoofProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_trust_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Mismatched task id test",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "spoof_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("REJECTED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain(
        "does not match delegation request id",
      );
    });

    it("rejects result with mismatched workspaceId", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const crossWsProvider = new MockAIProvider(
        "cross_ws_provider",
        "Cross WS AI",
        async () => ({
          success: true,
          taskId: "task_trust_002",
          workspaceId: "ws_other_victim",
          output: "Cross-tenant leaked output",
        }),
      );
      coordinator.registerProvider(crossWsProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_trust_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Cross workspace check",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "cross_ws_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("REJECTED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain(
        "does not match delegation workspaceId",
      );
    });

    it("rejects result attempting scope expansion or privileged execution", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const scopeExpandProvider = new MockAIProvider(
        "expand_provider",
        "Expand AI",
        async () => ({
          success: true,
          taskId: "task_trust_003",
          workspaceId: "ws_m10",
          output: { action: "EXECUTE_PRODUCTION", command: "rm -rf /" },
          scopeExpansionAttempted: true,
        }),
      );
      coordinator.registerProvider(scopeExpandProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_trust_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Scope expansion test",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "expand_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("REJECTED");
      expect(record.verificationStatus).toBe("REJECTED");
      expect(record.rejectionReason).toContain("scope expansion");
    });

    it("rejects result exceeding max response size limit", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const hugeOutputProvider = new MockAIProvider(
        "huge_provider",
        "Huge AI",
        async () => ({
          success: true,
          taskId: "task_trust_004",
          workspaceId: "ws_m10",
          output: "A".repeat(500),
        }),
      );
      coordinator.registerProvider(hugeOutputProvider);

      const req: ExternalAIDelegationRequest = {
        id: "task_trust_004",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Max response size test",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "huge_provider",
        maxResponseSize: 100, // max 100 chars
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("REJECTED");
      expect(record.rejectionReason).toContain("exceeds maximum allowed limit");
    });
  });

  describe("5. Approval Boundary & Replay Protection", () => {
    it("executes task after explicit owner approval", async () => {
      policyEngine.setRule("ai-code-refactor", "APPROVAL_REQUIRED");

      const req: ExternalAIDelegationRequest = {
        id: "task_app_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Refactor core logic",
        requestedCapability: "ai-code-refactor",
        input: { target: "src/core/coordination/index.ts" },
        providerId: "mock_ai_provider",
      };

      const initial = await coordinator.delegate(req);
      expect(initial.status).toBe("APPROVAL_REQUIRED");

      // Approve task
      const approvedRecord = await coordinator.approveDelegation(
        initial.id,
        ownerUser.userId,
        "ws_m10",
      );

      expect(approvedRecord.status).toBe("SUCCEEDED");
      expect(mockProvider.executeCallCount).toBe(1);
    });

    it("rejects replayed approval consumption", async () => {
      policyEngine.setRule("ai-code-refactor", "APPROVAL_REQUIRED");

      const req: ExternalAIDelegationRequest = {
        id: "task_app_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Replay test",
        requestedCapability: "ai-code-refactor",
        input: { target: "src/core/coordination/index.ts" },
        providerId: "mock_ai_provider",
      };

      const initial = await coordinator.delegate(req);
      expect(initial.status).toBe("APPROVAL_REQUIRED");

      await coordinator.approveDelegation(
        initial.id,
        ownerUser.userId,
        "ws_m10",
      );

      // Attempt replaying approval on same delegation record
      await expect(
        coordinator.approveDelegation(initial.id, ownerUser.userId, "ws_m10"),
      ).rejects.toThrow(/expected 'APPROVAL_REQUIRED'/);
    });

    it("rejects approval from non-active member or cross-workspace attempt", async () => {
      policyEngine.setRule("ai-code-refactor", "APPROVAL_REQUIRED");

      const stranger = identityStore.createUser({
        primaryEmail: "stranger@evil.com",
      });

      const req: ExternalAIDelegationRequest = {
        id: "task_app_003",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Cross workspace approval attempt",
        requestedCapability: "ai-code-refactor",
        input: {},
        providerId: "mock_ai_provider",
      };

      const initial = await coordinator.delegate(req);
      expect(initial.status).toBe("APPROVAL_REQUIRED");

      const rejectedRecord = await coordinator.approveDelegation(
        initial.id,
        stranger.userId,
        "ws_m10",
      );

      expect(rejectedRecord.status).toBe("REJECTED");
      expect(rejectedRecord.rejectionReason).toContain("not an active member");
      expect(mockProvider.executeCallCount).toBe(0);
    });
  });

  describe("6. Cancellation & Timeout Lifecycle", () => {
    it("cancels pending delegation and prevents execution", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_canc_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Cancel task test",
        requestedCapability: "ai-code-analysis",
        input: {},
        providerId: "mock_ai_provider",
      };

      const pending = coordinator.getDelegation("task_canc_001");
      expect(pending).toBeUndefined();

      // Create and cancel
      policyEngine.setRule("ai-long-task", "APPROVAL_REQUIRED");

      const longReq: ExternalAIDelegationRequest = {
        id: "task_canc_002",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Long task to cancel",
        requestedCapability: "ai-long-task",
        input: {},
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(longReq);
      expect(record.status).toBe("APPROVAL_REQUIRED");

      const cancelledRecord = await coordinator.cancelDelegation(
        record.id,
        "User aborted request before approval",
      );

      expect(cancelledRecord.status).toBe("CANCELLED");
      expect(cancelledRecord.cancellationReason).toBe(
        "User aborted request before approval",
      );
    });
  });

  describe("7. Security & Data Confidentiality", () => {
    it("redacts credentials and sensitive tokens from delegation input", async () => {
      policyEngine.setRule("ai-security-check", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_sec_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Analyze security configuration",
        requestedCapability: "ai-security-check",
        input: {
          config: "some_config",
          API_KEY: "secret_api_key_12345",
          PASSWORD: "super_secret_password",
          bearerHeader: "Bearer token_abc123",
        },
        providerId: "mock_ai_provider",
      };

      const record = await coordinator.delegate(req);

      expect(record.status).toBe("SUCCEEDED");
      const sanitizedInput = record.input as any;
      expect(sanitizedInput.API_KEY).toBe("[REDACTED_CREDENTIAL]");
      expect(sanitizedInput.PASSWORD).toBe("[REDACTED_CREDENTIAL]");

      const receivedReq = mockProvider.lastReceivedRequest;
      expect(receivedReq).toBeDefined();
      const providerInput = receivedReq?.input as any;
      expect(providerInput.API_KEY).toBe("[REDACTED_CREDENTIAL]");
      expect(providerInput.PASSWORD).toBe("[REDACTED_CREDENTIAL]");
    });

    it("verifies audit trail records complete delegation lifecycle", async () => {
      policyEngine.setRule("ai-code-analysis", "SAFE");

      const req: ExternalAIDelegationRequest = {
        id: "task_audit_001",
        ownerId: ownerUser.userId,
        workspaceId: "ws_m10",
        purpose: "Audit logging test",
        requestedCapability: "ai-code-analysis",
        input: { repo: "test" },
        providerId: "mock_ai_provider",
      };

      await coordinator.delegate(req);

      const events = await auditManager.queryEvents({ workspaceId: "ws_m10" });
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.map((e) => e.type)).toContain("TASK_CREATED");
      expect(events.map((e) => e.type)).toContain("ACTION_STARTED");
      expect(events.map((e) => e.type)).toContain("ACTION_COMPLETED");
    });
  });
});
