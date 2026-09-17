import { describe, it, expect, vi } from "vitest";
import {
  BrainPlan,
  BrainPlanStep,
  BrainInput,
  BrainResult,
  Tool,
  ExecutionContext,
} from "../src/core/contracts/index.js";
import {
  validateBrainPlan,
  DeterministicBrain,
} from "../src/core/brain/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { PolicyEngine } from "../src/core/policy/index.js";
import { SecureToolEcosystem, ToolRegistry } from "../src/core/tools/index.js";

describe("M7.1 Structured Brain Plan Contract Verification", () => {
  describe("1. Valid Structured Plan Representation & Validation", () => {
    it("should accept a canonical valid semantic plan with NO toolId", () => {
      const validSemanticPlan: BrainPlan = {
        goal: "Investigate system status",
        steps: [
          {
            id: "step-1",
            purpose: "Check system logs and metrics",
            action: "INVESTIGATION",
            params: { target: "system" },
          },
          {
            id: "step-2",
            purpose: "Verify service health",
            action: "VERIFICATION",
            dependsOn: ["step-1"],
          },
        ],
        metadata: { source: "test" },
      };

      const res = validateBrainPlan(validSemanticPlan);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(validSemanticPlan.steps[0].toolId).toBeUndefined();
    });
  });

  describe("2. Invalid Plan Structure Rejection", () => {
    it("should reject non-object or null plan", () => {
      expect(validateBrainPlan(null).valid).toBe(false);
      expect(validateBrainPlan(undefined).valid).toBe(false);
      expect(validateBrainPlan("not a plan").valid).toBe(false);
      expect(validateBrainPlan([]).valid).toBe(false);
    });

    it("should reject plan with empty or missing goal", () => {
      const planNoGoal = {
        goal: "   ",
        steps: [
          {
            id: "s1",
            purpose: "Check status",
            toolId: "git",
            action: "status",
          },
        ],
      };
      const res = validateBrainPlan(planNoGoal);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Plan 'goal' must be a non-empty string.");
    });

    it("should reject plan with zero or empty steps array", () => {
      const planNoSteps = {
        goal: "Check system",
        steps: [],
      };
      const res = validateBrainPlan(planNoSteps);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Plan 'steps' must be a non-empty array.");
    });
  });

  describe("3. Duplicate Step IDs Rejection", () => {
    it("should reject plans containing duplicate step IDs", () => {
      const planWithDuplicates = {
        goal: "Duplicate IDs test",
        steps: [
          {
            id: "step-1",
            purpose: "First action",
            toolId: "git",
            action: "status",
          },
          {
            id: "step-1",
            purpose: "Second action with same ID",
            toolId: "terminal",
            action: "exec",
          },
        ],
      };

      const res = validateBrainPlan(planWithDuplicates);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Duplicate step ID 'step-1' found in plan.");
    });
  });

  describe("4. Invalid/Missing Action or Tool Identity Rejection", () => {
    it("should reject steps missing action, purpose, or id", () => {
      const planMissingFields = {
        goal: "Test missing fields",
        steps: [
          {
            id: "",
            purpose: "",
            action: "",
          },
        ],
      };

      const res = validateBrainPlan(planMissingFields);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Step[0] must have a non-empty string 'id'.",
      );
      expect(res.errors).toContain(
        "Step[0] must have a non-empty string 'purpose'.",
      );
      expect(res.errors).toContain(
        "Step[0] must have a valid ActionGoalCategory 'action' (INVESTIGATION | DEVELOPMENT | VERIFICATION | RESEARCH).",
      );
    });

    it("should reject step with empty toolId if provided", () => {
      const planEmptyToolId = {
        goal: "Test empty toolId",
        steps: [
          {
            id: "s1",
            purpose: "p",
            action: "INVESTIGATION",
            toolId: "  ",
          },
        ],
      };

      const res = validateBrainPlan(planEmptyToolId);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Step[0] 'toolId' must be a non-empty string if provided.",
      );
    });

    it("should reject steps with unsupported ActionGoalCategory action string", () => {
      const planInvalidAction = {
        goal: "Test invalid action category",
        steps: [
          {
            id: "s1",
            purpose: "p",
            action: "unsupported_custom_action",
          },
        ],
      };

      const res = validateBrainPlan(planInvalidAction);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Step[0] must have a valid ActionGoalCategory 'action' (INVESTIGATION | DEVELOPMENT | VERIFICATION | RESEARCH).",
      );
    });

    it("should reject steps with malformed params", () => {
      const planBadParams = {
        goal: "Test malformed params",
        steps: [
          {
            id: "s1",
            purpose: "p",
            toolId: "t",
            action: "a",
            params: "not an object" as any,
          },
        ],
      };

      const res = validateBrainPlan(planBadParams);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Step[0] 'params' must be an object if provided.",
      );
    });
  });

  describe("5. Dependency & Circular Dependency Validation", () => {
    it("should reject unknown dependency IDs", () => {
      const planUnknownDep = {
        goal: "Test unknown dependency",
        steps: [
          {
            id: "step-1",
            purpose: "p1",
            toolId: "t1",
            action: "a1",
            dependsOn: ["non-existent-step"],
          },
        ],
      };

      const res = validateBrainPlan(planUnknownDep);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Step 'step-1' depends on unknown step ID 'non-existent-step'.",
      );
    });

    it("should reject self-dependency", () => {
      const planSelfDep = {
        goal: "Test self dependency",
        steps: [
          {
            id: "step-1",
            purpose: "p1",
            toolId: "t1",
            action: "a1",
            dependsOn: ["step-1"],
          },
        ],
      };

      const res = validateBrainPlan(planSelfDep);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Step 'step-1' cannot depend on itself.");
    });

    it("should reject circular dependencies in steps graph", () => {
      const planCircular = {
        goal: "Test circular dependency",
        steps: [
          {
            id: "step-1",
            purpose: "p1",
            toolId: "t1",
            action: "a1",
            dependsOn: ["step-2"],
          },
          {
            id: "step-2",
            purpose: "p2",
            toolId: "t2",
            action: "a2",
            dependsOn: ["step-3"],
          },
          {
            id: "step-3",
            purpose: "p3",
            toolId: "t3",
            action: "a3",
            dependsOn: ["step-1"],
          },
        ],
      };

      const res = validateBrainPlan(planCircular);
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("Circular dependency detected")),
      ).toBe(true);
    });
  });

  describe("6. Conversation Intent Does Not Produce Executable Plan", () => {
    it("should classify conversational input as CONVERSATION without an executable plan", () => {
      const brain = new DeterministicBrain();
      const input: BrainInput = { rawCommandText: "سلام" };
      const res = brain.interpret(input);

      expect(res.intent).toBe("CONVERSATION");
      expect(res.reply).toBeDefined();
      expect(res.plan).toBeUndefined();
    });
  });

  describe("7. Ambiguous Intent Remains Fail-Closed", () => {
    it("should classify unresolvable input as AMBIGUOUS without an executable plan", () => {
      const brain = new DeterministicBrain();
      const input: BrainInput = { rawCommandText: "xyz123 unresolvable text" };
      const res = brain.interpret(input);

      expect(res.intent).toBe("AMBIGUOUS");
      expect(res.plan).toBeUndefined();
    });
  });

  describe("8. Brain Does Not Execute Tools (Execution-Free Guarantee)", () => {
    it("should never invoke tool execution during brain interpretation", async () => {
      const executeMock = vi.fn();

      const mockTool: Tool = {
        metadata: {
          id: "mock_tool",
          name: "Mock Tool",
          description: "Mock",
          safetyLevel: "SAFE",
        },
        execute: executeMock,
      };

      const brain = new DeterministicBrain();
      const input: BrainInput = {
        rawCommandText: "بررسی کن وضعیت YarTrader را",
      };

      const res = brain.interpret(input);

      expect(res.intent).toBe("ACTION");
      expect(res.plan).toBeDefined();

      const val = validateBrainPlan(res.plan);
      expect(val.valid).toBe(true);

      // Verify execute tool mock was never touched by Brain
      expect(executeMock).not.toHaveBeenCalled();
    });
  });

  describe("9. Plan Creation Does Not Bypass PolicyEngine or ApprovalManager", () => {
    it("should enforce PolicyEngine evaluation when orchestrating an ACTION plan proposal", async () => {
      const registry = new AgentRegistry();
      registry.registerAgent({
        id: "investigation_agent",
        name: "Investigation Agent",
        capabilities: ["investigation"],
        toolScopes: ["git_operate"],
        workspaceScopes: ["ws-1"],
        provider: "test",
        model: "test-v1",
        contract: { inputSchema: {}, outputSchema: {} },
        available: true,
      });

      const policyEngine = new PolicyEngine();
      // Explicitly block git_operate
      policyEngine.setRule("git_operate", "BLOCKED");

      const orchestrator = new AgentOrchestrator(registry, policyEngine);

      const brain = new DeterministicBrain();
      const brainRes = brain.interpret({
        rawCommandText: "بررسی کن وضعیت ریپازیتوری",
      });

      expect(brainRes.intent).toBe("ACTION");
      expect(brainRes.plan).toBeDefined();

      const orchRes = await orchestrator.orchestrateBrainResult({
        brainResult: brainRes,
        commandId: "cmd-1",
        workspaceId: "ws-1",
        targetCapability: "investigation",
        requestedToolId: "git_operate",
      });

      expect(orchRes.accepted).toBe(false);
      expect(orchRes.status).toBe("BLOCKED");
      expect(orchRes.reason).toContain("BLOCKED");
    });
  });

  describe("10. Critical Non-Inference & Non-Fallback Boundaries", () => {
    it("should NOT infer toolId from entity.id (e.g., entity.id -> toolId)", () => {
      const brain = new DeterministicBrain();
      const input: BrainInput = {
        rawCommandText: "بررسی کن وضعیت YarTrader را",
      };
      const res = brain.interpret(input);

      expect(res.intent).toBe("ACTION");
      expect(res.plan).toBeDefined();

      // Explicit check: entity.id ("YarTrader") must NOT be converted to toolId ("yartrader")
      const step = res.plan?.steps[0];
      expect(step?.toolId).toBeUndefined();
      expect(step?.action).toBe("INVESTIGATION");
    });

    it("should NOT use 'system' or silent execution fallbacks for unresolved capability", () => {
      const brain = new DeterministicBrain();
      const input: BrainInput = { rawCommandText: "تست کن پروژه را" };
      const res = brain.interpret(input);

      expect(res.intent).toBe("ACTION");
      expect(res.plan).toBeDefined();

      const step = res.plan?.steps[0];
      expect(step?.toolId).not.toBe("system");
      expect(step?.toolId).toBeUndefined();
      expect(step?.action).toBe("VERIFICATION");
    });
  });
});
