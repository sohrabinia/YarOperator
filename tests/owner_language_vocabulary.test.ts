import { describe, it, expect, vi } from "vitest";
import { BrainInput, Tool } from "../src/core/contracts/index.js";
import {
  DeterministicBrain,
  validateBrainPlan,
  OperatorKnowledgeBase,
} from "../src/core/brain/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";

describe("Owner Language Vocabulary v1.1 Integration Suite", () => {
  const brain = new DeterministicBrain();

  it("1. Pure greeting produces CONVERSATION", () => {
    const input: BrainInput = { rawCommandText: "سلام" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("CONVERSATION");
    expect(res.reply).toBeDefined();
    expect(res.plan).toBeUndefined();
  });

  it("2. Greeting mixed with actionable command produces ACTION (Greeting + Action rule)", () => {
    const input: BrainInput = { rawCommandText: "سلام، یارتریدر رو بررسی کن" };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.actionGoal).toBe("INVESTIGATION");
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
  });

  it("3. Ambiguous entity-only inputs fail closed to AMBIGUOUS with plan undefined", () => {
    const entityOnlyInputs = [
      "YarTrader",
      "Amlakbashi",
      "GitHub",
      "سرور",
      "PR",
      "تست",
      "مشکل",
      "XAUUSD",
      "Jules",
    ];

    for (const text of entityOnlyInputs) {
      const res = brain.interpret({ rawCommandText: text });
      expect(res.intent).toBe("AMBIGUOUS");
      expect(res.plan).toBeUndefined();
    }
  });

  it("4. Investigation phrases in Persian and mixed English resolve to INVESTIGATION", () => {
    const cases = [
      "یارتریدر رو بررسی کن",
      "سرور رو بررسی کن",
      "PR رو بررسی کن",
      "YarTrader رو check کن",
      "سرور رو inspect کن",
      "repo رو بررسی کن",
      "PR رو review کن",
      "branch رو check کن",
      "logs رو بررسی کن",
    ];

    for (const text of cases) {
      const res = brain.interpret({ rawCommandText: text });
      expect(res.intent).toBe("ACTION");
      expect(res.actionGoal).toBe("INVESTIGATION");
      expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    }
  });

  it("5. Development phrases in Persian and mixed English resolve to DEVELOPMENT", () => {
    const cases = [
      "یارتریدر رو درست کن",
      "کد رو اصلاح کن",
      "مشکل رو حل کن",
      "کد رو fix کن",
    ];

    for (const text of cases) {
      const res = brain.interpret({ rawCommandText: text });
      expect(res.intent).toBe("ACTION");
      expect(res.actionGoal).toBe("DEVELOPMENT");
      expect(res.plan?.steps[0].action).toBe("DEVELOPMENT");
    }
  });

  it("6. Verification phrases in Persian and mixed English resolve to VERIFICATION", () => {
    const cases = [
      "یارتریدر رو تست کن",
      "تست‌ها رو اجرا کن",
      "ببین درست شده یا نه",
      "test رو run کن",
      "build رو verify کن",
    ];

    for (const text of cases) {
      const res = brain.interpret({ rawCommandText: text });
      expect(res.intent).toBe("ACTION");
      expect(res.actionGoal).toBe("VERIFICATION");
      expect(res.plan?.steps[0].action).toBe("VERIFICATION");
    }
  });

  it("7. Research phrases resolve to RESEARCH without category collision", () => {
    const cases = [
      "درباره یارتریدر تحقیق کن",
      "درباره املاک باشی تحقیق کن",
      "در اینترنت بررسی کن",
      "Amlakbashi رو research کن",
    ];

    for (const text of cases) {
      const res = brain.interpret({ rawCommandText: text });
      expect(res.intent).toBe("ACTION");
      expect(res.actionGoal).toBe("RESEARCH");
      expect(res.plan?.steps[0].action).toBe("RESEARCH");
    }
  });

  it("8. Negation/restrictions preserve goal while recording restriction metadata", () => {
    const input: BrainInput = {
      rawCommandText: "PR رو بررسی کن ولی مرج نکن",
    };
    const res = brain.interpret(input);

    expect(res.intent).toBe("ACTION");
    expect(res.actionGoal).toBe("INVESTIGATION");
    expect(res.plan?.steps[0].action).toBe("INVESTIGATION");
    expect(res.metadata?.restrictions).toContain("NO_MERGE");
  });

  it("9. Zero execution authority boundary guarantee", () => {
    const executeMock = vi.fn();
    const mockTool: Tool = {
      metadata: {
        id: "mock_vocab_tool",
        name: "Mock",
        description: "Mock",
        safetyLevel: "SAFE",
      },
      execute: executeMock,
    };

    const evalSpy = vi.spyOn(PolicyEngine.prototype, "evaluate");
    const approvalSpy = vi.spyOn(ApprovalManager.prototype, "consumeApproval");

    const res = brain.interpret({
      rawCommandText: "وضعیت سرور را check کن و بعد test رو run کن",
    });

    expect(res.intent).toBe("ACTION");
    expect(res.plan).toBeDefined();
    expect(executeMock).not.toHaveBeenCalled();
    expect(evalSpy).not.toHaveBeenCalled();
    expect(approvalSpy).not.toHaveBeenCalled();

    for (const step of res.plan!.steps) {
      expect(step.toolId).toBeUndefined();
    }

    evalSpy.mockRestore();
    approvalSpy.mockRestore();
  });

  it("10. Repeated identical input produces deterministic output", () => {
    const input: BrainInput = {
      rawCommandText: "کد رو fix کن و بعد test رو run کن",
    };

    const res1 = brain.interpret(input);
    const res2 = brain.interpret(input);

    expect(res1).toEqual(res2);
  });
});
