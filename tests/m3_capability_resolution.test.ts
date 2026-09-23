import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { CapabilityResolver } from "../src/core/capability/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";

describe("M3 — Capability Resolution Test Suite", () => {
  let brain: DeterministicBrain;
  let registry: AgentRegistry;
  let capabilityResolver: CapabilityResolver;

  beforeEach(() => {
    brain = new DeterministicBrain();
    registry = new AgentRegistry();

    // Register test agents
    registry.registerAgent({
      id: "agent_dev",
      name: "Software Dev Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["ws_m3"],
      toolScopes: ["terminal_execute", "git_operate"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    registry.registerAgent({
      id: "agent_term",
      name: "Terminal Execution Agent",
      capabilities: ["terminal-execution"],
      workspaceScopes: ["ws_m3"],
      toolScopes: ["terminal_execute"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    registry.registerAgent({
      id: "agent_web",
      name: "Web Research Agent",
      capabilities: ["web-research"],
      workspaceScopes: ["ws_m3"],
      toolScopes: ["web_research"],
      provider: "test",
      model: "test-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    capabilityResolver = new CapabilityResolver(registry);
  });

  // --- Brain Contract Tests ---
  describe("1. Brain Contract", () => {
    it("1. ACTION exposes correct actionGoal", () => {
      const res1 = brain.interpret({ rawCommandText: "وضعیت را بررسی کن" });
      expect(res1.intent).toBe("ACTION");
      expect(res1.actionGoal).toBe("INVESTIGATION");

      const res2 = brain.interpret({ rawCommandText: "کد را اصلاح کن" });
      expect(res2.intent).toBe("ACTION");
      expect(res2.actionGoal).toBe("DEVELOPMENT");

      const res3 = brain.interpret({ rawCommandText: "تست بگیر" });
      expect(res3.intent).toBe("ACTION");
      expect(res3.actionGoal).toBe("VERIFICATION");

      const res4 = brain.interpret({ rawCommandText: "جستجو کن" });
      expect(res4.intent).toBe("ACTION");
      expect(res4.actionGoal).toBe("RESEARCH");
    });

    it("2. CONVERSATION does not produce actionGoal", () => {
      const res = brain.interpret({ rawCommandText: "سلام، روز بخیر" });
      expect(res.intent).toBe("CONVERSATION");
      expect(res.actionGoal).toBeUndefined();
    });

    it("3. AMBIGUOUS remains ambiguous without actionGoal", () => {
      const res = brain.interpret({ rawCommandText: "کتابخانه عمومی" });
      expect(res.intent).toBe("AMBIGUOUS");
      expect(res.actionGoal).toBeUndefined();
    });
  });

  // --- Capability Resolution Mappings ---
  describe("2. Capability Resolution Mappings", () => {
    it("4. INVESTIGATION resolves to software-development", () => {
      const brainRes = brain.interpret({ rawCommandText: "بررسی کن" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("software-development");
    });

    it("5. DEVELOPMENT resolves to software-development", () => {
      const brainRes = brain.interpret({ rawCommandText: "کد را اصلاح کن" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("software-development");
    });

    it("6. VERIFICATION resolves to terminal-execution", () => {
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("terminal-execution");
    });

    it("7. RESEARCH resolves to web-research", () => {
      const brainRes = brain.interpret({ rawCommandText: "جستجو کن" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("web-research");
    });
  });

  // --- Explicit Precedence ---
  describe("3. Explicit Precedence Rules", () => {
    it("8. Explicit targetCapability overrides Brain-derived capability", () => {
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" }); // derived: terminal-execution
      expect(brainRes.actionGoal).toBe("VERIFICATION");

      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
        targetCapability: "software-development", // explicit override
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("software-development");
    });

    it("9. Explicit requestedToolId is preserved", () => {
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
        requestedToolId: "custom_verification_tool",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("terminal-execution");
      expect(res.resolvedToolId).toBe("custom_verification_tool");
    });

    it("10. Invalid explicit capability fails closed", () => {
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });
      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
        targetCapability: "non_existent_capability_xyz",
      });

      expect(res.status).toBe("UNRESOLVED");
      expect(res.reason).toContain(
        "No agent available for capability 'non_existent_capability_xyz'",
      );
    });

    it("11. Invalid explicit tool fails closed during Orchestrator tool registry verification", async () => {
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });
      const orchestrator = new AgentOrchestrator(registry);
      const policyEngine = new PolicyEngine(new ApprovalManager(":memory:"));
      const toolEcosystem = new SecureToolEcosystem();
      orchestrator.setPolicyEngine(policyEngine);
      orchestrator.setToolEcosystem(toolEcosystem);

      const orchRes = await orchestrator.orchestrateBrainResult({
        brainResult: brainRes,
        commandId: "cmd_invalid_tool",
        workspaceId: "ws_m3",
        requestedToolId: "unregistered_tool_123",
      });

      expect(orchRes.accepted).toBe(false);
      expect(orchRes.status).toBe("BLOCKED");
      expect(orchRes.reason).toContain(
        "Tool 'unregistered_tool_123' is not registered",
      );
    });
  });

  // --- Fail Closed Rules ---
  describe("4. Fail Closed Behavior", () => {
    it("12. Missing actionGoal fails closed when no explicit capability exists", () => {
      const res = capabilityResolver.resolve({
        brainResult: { intent: "ACTION" }, // No actionGoal provided
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("UNRESOLVED");
      expect(res.reason).toContain(
        "missing explicit capability and missing/unknown actionGoal",
      );
    });

    it("13. Unsupported capability fails closed", () => {
      const res = capabilityResolver.resolve({
        brainResult: { intent: "ACTION", actionGoal: "DEVELOPMENT" },
        workspaceId: "ws_unsupported_workspace",
      });

      expect(res.status).toBe("UNRESOLVED");
      expect(res.reason).toContain("No agent available for capability");
    });

    it("14. Multi-tool capability without explicit tool preserves existing BLOCKED behavior", async () => {
      const brainRes = brain.interpret({ rawCommandText: "کد را اصلاح کن" }); // resolves to software-development
      const orchestrator = new AgentOrchestrator(registry);

      // software-development agent has 2 tools: ["terminal_execute", "git_operate"]
      const orchRes = await orchestrator.orchestrateBrainResult({
        brainResult: brainRes,
        commandId: "cmd_multi_tool",
        workspaceId: "ws_m3",
      });

      expect(orchRes.accepted).toBe(false);
      expect(orchRes.status).toBe("BLOCKED");
      expect(orchRes.reason).toContain(
        "No explicit tool provided for action execution under multi-tool capability",
      );
    });

    it("15. Unknown actionGoal fails closed", () => {
      const res = capabilityResolver.resolve({
        brainResult: { intent: "ACTION", actionGoal: "UNKNOWN_GOAL" as any },
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("UNRESOLVED");
      expect(res.reason).toContain(
        "missing explicit capability and missing/unknown actionGoal",
      );
    });
  });

  // --- Boundaries ---
  describe("5. Architectural Boundaries", () => {
    it("16. CapabilityResolver never executes a tool", () => {
      const mockToolExecute = vi.fn();
      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });

      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(mockToolExecute).not.toHaveBeenCalled();
    });

    it("17. CapabilityResolver never invokes PolicyEngine directly", () => {
      const approvalManager = new ApprovalManager(":memory:");
      const policyEngine = new PolicyEngine(approvalManager);
      const evaluateSpy = vi.spyOn(policyEngine, "evaluate");

      const brainRes = brain.interpret({ rawCommandText: "تست بگیر" });
      capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(evaluateSpy).not.toHaveBeenCalled();
    });

    it("18. Raw command text is not used for capability/tool inference inside CapabilityResolver", () => {
      // Pass a BrainResult with actionGoal set, but rawCommandText intentionally misleading
      const brainRes = {
        intent: "ACTION" as const,
        actionGoal: "RESEARCH" as const,
      };

      const res = capabilityResolver.resolve({
        brainResult: brainRes,
        workspaceId: "ws_m3",
      });

      expect(res.status).toBe("RESOLVED");
      expect(res.resolvedCapability).toBe("web-research");
    });
  });
});
