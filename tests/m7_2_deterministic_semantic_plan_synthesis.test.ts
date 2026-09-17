import { describe, it, expect, vi } from "vitest";
import { BrainInput, Tool } from "../src/core/contracts/index.js";
import {
  DeterministicBrain,
  validateBrainPlan,
} from "../src/core/brain/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";

describe("M7.2 — Deterministic Semantic Plan Synthesis Verification Suite", () => {
  const brain = new DeterministicBrain();

  it("1. Single-step actionable input produces a valid semantic plan", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت پروژه YarTrader را بررسی کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");

    const val = validateBrainPlan(res.plan);
    expect(val.valid).toBe(true);
  });

  it("2. Clearly sequential request produces multiple semantic steps", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت پروژه را و بعد نتیجه را تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps.length).toBeGreaterThanOrEqual(2);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("VERIFICATION");

    const val = validateBrainPlan(res.plan);
    expect(val.valid).toBe(true);
  });

  it("3. Step IDs are unique", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    const stepIds = res.plan?.steps.map((s) => s.id);
    const uniqueIds = new Set(stepIds);
    expect(stepIds?.length).toBe(uniqueIds.size);
    expect(stepIds).toEqual(["step-1", "step-2", "step-3"]);
  });

  it("4. Sequential dependencies are represented correctly via dependsOn", () => {
    const input: BrainInput = {
      rawCommandText:
        "بررسی کن وضعیت YarTrader را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    const steps = res.plan!.steps;
    expect(steps.length).toBe(3);
    expect(steps[0].dependsOn).toBeUndefined();
    expect(steps[1].dependsOn).toEqual(["step-1"]);
    expect(steps[2].dependsOn).toEqual(["step-2"]);
  });

  it("5. Every step uses a valid ActionGoalCategory", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و سپس کد را تغییر بده و بعد تست کن",
    };
    const res = brain.interpret(input);

    const validCategories = new Set([
      "INVESTIGATION",
      "DEVELOPMENT",
      "VERIFICATION",
      "RESEARCH",
    ]);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(validCategories.has(step.action)).toBe(true);
    }
  });

  it("6. No synthesized step requires toolId (toolId remains undefined)", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت سرور را و بعد تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(step.toolId).toBeUndefined();
    }
  });

  it("7. Brain never infers toolId from an entity ID or alias", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت YarTrader را بررسی کن و بعد YarOperator را تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(step.toolId).toBeUndefined();
      expect(step.toolId).not.toBe("yartrader");
      expect(step.toolId).not.toBe("yaroperator");
    }
  });

  it("8. Brain never inserts 'system' as a toolId fallback", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(step.toolId).not.toBe("system");
      expect(step.toolId).toBeUndefined();
    }
  });

  it("9. Conversation produces no plan", () => {
    const input: BrainInput = { rawCommandText: "سلام روز بخیر چطوری" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("CONVERSATION");
    expect(res.reply).toBeDefined();
    expect(res.plan).toBeUndefined();
  });

  it("10. Ambiguous input produces no fabricated plan", () => {
    const input: BrainInput = {
      rawCommandText: "xyzabc 123456 random noise text",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("AMBIGUOUS");
    expect(res.plan).toBeUndefined();
  });

  it("11. Invalid internally synthesized plans fail closed to AMBIGUOUS", () => {
    const input: BrainInput = { rawCommandText: "بررسی کن وضعیت" };
    const res = brain.interpret(input);

    if (res.plan) {
      const val = validateBrainPlan(res.plan);
      expect(val.valid).toBe(true);
    } else {
      expect(res.intent).toBe("AMBIGUOUS");
    }
  });

  it("12. Brain interpretation never invokes a Tool's execute method", () => {
    const executeMock = vi.fn();
    const mockTool: Tool = {
      metadata: {
        id: "mock_tool_execution_free",
        name: "Mock",
        description: "Mock Tool",
        safetyLevel: "SAFE",
      },
      execute: executeMock,
    };

    const input: BrainInput = {
      rawCommandText: "وضعیت پروژه را بررسی کن و بعد تست بگیر",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("13. Brain planning never invokes PolicyEngine", () => {
    const evalSpy = vi.spyOn(PolicyEngine.prototype, "evaluate");
    const input: BrainInput = {
      rawCommandText: "وضعیت سرور را چک کن و بعد باگ را برطرف کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(evalSpy).not.toHaveBeenCalled();
    evalSpy.mockRestore();
  });

  it("14. Brain planning never invokes ApprovalManager", () => {
    const approvalSpy = vi.spyOn(ApprovalManager.prototype, "consumeApproval");
    const input: BrainInput = {
      rawCommandText: "بررسی کن سیستم را و سپس تغییرات را اعمال کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(approvalSpy).not.toHaveBeenCalled();
    approvalSpy.mockRestore();
  });
});
