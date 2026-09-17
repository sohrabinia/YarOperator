import { describe, it, expect, vi } from "vitest";
import { BrainInput, Tool } from "../src/core/contracts/index.js";
import {
  DeterministicBrain,
  validateBrainPlan,
  OperatorKnowledgeBase,
} from "../src/core/brain/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";

describe("M7.2 — Deterministic Semantic Plan Synthesis Forensic Test Suite", () => {
  const brain = new DeterministicBrain();

  it("1. Single-step INVESTIGATION plan synthesis", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت پروژه YarTrader را بررسی کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[0].toolId).toBeUndefined();
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("2. Single-step DEVELOPMENT plan synthesis", () => {
    const input: BrainInput = { rawCommandText: "باگ موجود را برطرف کن" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.plan?.steps[0].action).toBe("DEVELOPMENT");
    expect(res.plan?.steps[0].toolId).toBeUndefined();
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("3. Single-step VERIFICATION plan synthesis", () => {
    const input: BrainInput = { rawCommandText: "تست‌های پروژه را اجرا کن" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.plan?.steps[0].action).toBe("VERIFICATION");
    expect(res.plan?.steps[0].toolId).toBeUndefined();
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("4. Single-step RESEARCH plan synthesis", () => {
    const input: BrainInput = {
      rawCommandText: "در اینترنت درباره فناوری جدید تحقیق کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(1);
    expect(res.plan?.steps[0].action).toBe("RESEARCH");
    expect(res.plan?.steps[0].toolId).toBeUndefined();
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("5. Two-step sequential decomposition (INVESTIGATION -> VERIFICATION)", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت پروژه را و بعد نتیجه را تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(2);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("VERIFICATION");
    expect(res.plan?.steps[1].dependsOn).toEqual(["step-1"]);
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("6. Three-step sequential decomposition (INVESTIGATION -> DEVELOPMENT -> VERIFICATION)", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(3);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("DEVELOPMENT");
    expect(res.plan?.steps[2].action).toBe("VERIFICATION");
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });

  it("7. Step IDs are deterministic and unique (step-1, step-2, step-3)", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    const ids = res.plan!.steps.map((s) => s.id);
    expect(ids).toEqual(["step-1", "step-2", "step-3"]);
  });

  it("8. Sequential dependsOn chain is correctly linked without gaps or cycles", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    const steps = res.plan!.steps;
    expect(steps[0].dependsOn).toBeUndefined();
    expect(steps[1].dependsOn).toEqual(["step-1"]);
    expect(steps[2].dependsOn).toEqual(["step-2"]);
  });

  it("9. Every synthesized step uses a valid ActionGoalCategory", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد اصلاح کن و سپس تست کن",
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

  it("10. No toolId is present in synthesized plans (toolId === undefined)", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت سرور را بررسی کن و بعد تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(step.toolId).toBeUndefined();
    }
  });

  it("11. Entity IDs (e.g., YarTrader) are never converted into toolId", () => {
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

  it("12. 'system' is never assigned as a toolId fallback", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن و بعد تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      expect(step.toolId).not.toBe("system");
      expect(step.toolId).toBeUndefined();
    }
  });

  it("13. Pure conversation produces no plan (intent: CONVERSATION, plan: undefined)", () => {
    const input: BrainInput = { rawCommandText: "سلام روز بخیر چطوری" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("CONVERSATION");
    expect(res.reply).toBeDefined();
    expect(res.plan).toBeUndefined();
  });

  it("14. Ambiguous input produces no fabricated plan (intent: AMBIGUOUS, plan: undefined)", () => {
    const input: BrainInput = { rawCommandText: "xyzabc 123456 random text" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("AMBIGUOUS");
    expect(res.plan).toBeUndefined();
  });

  it("15. Ambiguous second sequential segment causes entire plan to fail closed", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد xyzabc123",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("AMBIGUOUS");
    expect(res.plan).toBeUndefined();
  });

  it("16. Malformed sequential input fails closed to AMBIGUOUS", () => {
    const input: BrainInput = {
      rawCommandText: "و بعد سپس بعدش",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("AMBIGUOUS");
    expect(res.plan).toBeUndefined();
  });

  it("17. Plan validator accepts every synthesized valid plan", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت پروژه را بررسی کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    const val = validateBrainPlan(res.plan);
    expect(val.valid).toBe(true);
    expect(val.errors).toHaveLength(0);
  });

  it("18. Brain interpretation never invokes Tool.execute()", () => {
    const executeMock = vi.fn();
    const mockTool: Tool = {
      metadata: {
        id: "mock_tool_exec",
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

  it("19. Brain planning never invokes PolicyEngine", () => {
    const evalSpy = vi.spyOn(PolicyEngine.prototype, "evaluate");
    const input: BrainInput = {
      rawCommandText: "وضعیت سرور را چک کن و بعد باگ را برطرف کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(evalSpy).not.toHaveBeenCalled();
    evalSpy.mockRestore();
  });

  it("20. Brain planning never invokes ApprovalManager", () => {
    const approvalSpy = vi.spyOn(ApprovalManager.prototype, "consumeApproval");
    const input: BrainInput = {
      rawCommandText: "بررسی کن سیستم را و سپس کد را تغییر بده",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(approvalSpy).not.toHaveBeenCalled();
    approvalSpy.mockRestore();
  });

  it("21. Sequential plan generation performs zero execution", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    // Verify plan is purely structural description without runtime execution artifacts
    for (const step of res.plan!.steps) {
      expect(step.params).toBeUndefined();
      expect(step.toolId).toBeUndefined();
    }
  });

  it("22. Sequential plan generation performs zero capability resolution", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت YarTrader را و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    // Capability resolution is strictly Orchestrator's job, not Brain's
    expect((res.plan as any).resolvedCapability).toBeUndefined();
    for (const step of res.plan!.steps) {
      expect((step as any).capability).toBeUndefined();
    }
  });

  it("23. Research vocabulary resolves to RESEARCH without category collision", () => {
    const input: BrainInput = { rawCommandText: "درباره مشکل تحقیق کن" };
    const goal = OperatorKnowledgeBase.resolveActionGoal("تحقیق کن");
    expect(goal).toBe("RESEARCH");

    const res = brain.interpret(input);
    expect(res.intent).toBe("ACTION");
    expect(res.actionGoal).toBe("RESEARCH");
    expect(res.plan?.steps[0].action).toBe("RESEARCH");
  });

  it("24. Deterministic repeated input produces structurally identical output", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };

    const res1 = brain.interpret(input);
    const res2 = brain.interpret(input);

    expect(res1).toEqual(res2);
    expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
  });

  it("25. Multi-step synthesis creates no invented intermediate steps", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت پروژه را و بعد نتیجه را تست کن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan?.steps).toHaveLength(2);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("VERIFICATION");
  });

  it("26. Dependency chain contains no self-dependency", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و سپس باگ را برطرف کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    for (const step of res.plan!.steps) {
      if (step.dependsOn) {
        expect(step.dependsOn.includes(step.id)).toBe(false);
      }
    }
  });

  it("27. Dependency chain contains no unknown step IDs", () => {
    const input: BrainInput = {
      rawCommandText: "بررسی کن وضعیت را و بعد باگ را برطرف کن و سپس تست کن",
    };
    const res = brain.interpret(input);

    expect(res.plan).toBeDefined();
    const allStepIds = new Set(res.plan!.steps.map((s) => s.id));
    for (const step of res.plan!.steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          expect(allStepIds.has(depId)).toBe(true);
        }
      }
    }
  });

  it("28. Conversation alongside ambiguous action does not fabricate a multi-step plan", () => {
    const input: BrainInput = {
      rawCommandText: "سلام چطوری و بعد xyzabc123",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("AMBIGUOUS");
    expect(res.plan).toBeUndefined();
  });

  it("29. English sequential syntax remains deterministic", () => {
    const input: BrainInput = {
      rawCommandText: "check status and then run tests",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(2);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("VERIFICATION");
    expect(res.plan?.steps[1].dependsOn).toEqual(["step-1"]);
  });

  it("30. Persian sequential syntax remains deterministic", () => {
    const input: BrainInput = {
      rawCommandText: "وضعیت را بررسی کن و سپس باگ را برطرف کن و بعدش تست بگیر",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps).toHaveLength(3);
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.plan?.steps[1].action).toBe("DEVELOPMENT");
    expect(res.plan?.steps[2].action).toBe("VERIFICATION");
    expect(res.plan?.steps[1].dependsOn).toEqual(["step-1"]);
    expect(res.plan?.steps[2].dependsOn).toEqual(["step-2"]);
    expect(validateBrainPlan(res.plan).valid).toBe(true);
  });
});
