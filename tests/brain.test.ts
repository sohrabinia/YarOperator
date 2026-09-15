import { describe, it, expect } from "vitest";
import {
  DeterministicBrain,
  Normalizer,
  OperatorKnowledgeBase,
} from "../src/core/brain/index.js";
import { BrainInput } from "../src/core/contracts/index.js";

describe("DeterministicBrain M1 Operator Core Knowledge Capabilities", () => {
  const brain = new DeterministicBrain();

  describe("Persian Normalization & Entity Aliases", () => {
    it("should resolve YarTrader aliases consistently to YarTrader entity", () => {
      const yarTraderAliases = [
        "YarTrader",
        "yartrader",
        "یار تریدر",
        "یارتریدر",
        "یار‌تریدر",
        "پروژه یار تریدر",
        "پروژه یارتریدر",
      ];

      for (const alias of yarTraderAliases) {
        const entity = OperatorKnowledgeBase.resolveEntity(alias);
        expect(entity).toBeDefined();
        expect(entity?.id).toBe("YarTrader");
      }
    });

    it("should resolve Amlakbashi aliases consistently to Amlakbashi entity", () => {
      const amlakbashiAliases = [
        "Amlakbashi",
        "amlakbashi",
        "املاک‌باشی",
        "املاک باشی",
        "املاکباشی",
        "سایت املاک‌باشی",
        "سایت املاک باشی",
      ];

      for (const alias of amlakbashiAliases) {
        const entity = OperatorKnowledgeBase.resolveEntity(alias);
        expect(entity).toBeDefined();
        expect(entity?.id).toBe("Amlakbashi");
      }
    });

    it("should resolve YarOperator aliases consistently to YarOperator entity", () => {
      const yarOperatorAliases = [
        "YarOperator",
        "یار اپراتور",
        "یاراپراتور",
        "یار‌اپراتور",
        "اپراتور",
      ];

      for (const alias of yarOperatorAliases) {
        const entity = OperatorKnowledgeBase.resolveEntity(alias);
        expect(entity).toBeDefined();
        expect(entity?.id).toBe("YarOperator");
      }
    });

    it("should normalize Persian نیم‌فاصله, spacing and punctuation correctly", () => {
      const raw = "یار‌تریدر،  املاک‌باشی!  سایت-سرور؟";
      const normalized = Normalizer.normalize(raw);
      expect(normalized).toBe("یار تریدر املاک باشی سایت سرور");
    });
  });

  describe("Conversation Classification & Greetings", () => {
    const conversationInputs = [
      { text: "سلام", expectedSubstring: "سلام" },
      { text: "سلام خوبی؟", expectedSubstring: "سلام" },
      { text: "سلام، خوبی؟", expectedSubstring: "سلام" },
      { text: "درود", expectedSubstring: "سلام" },
      { text: "ممنون", expectedSubstring: "خواهش" },
      { text: "مرسی", expectedSubstring: "خواهش" },
      { text: "خداحافظ", expectedSubstring: "خداحافظ" },
    ];

    for (const item of conversationInputs) {
      it(`should classify "${item.text}" as CONVERSATION with reply`, () => {
        const input: BrainInput = { rawCommandText: item.text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("CONVERSATION");
        expect(result.reply).toBeDefined();
        expect(result.reply).toContain(item.expectedSubstring);
      });
    }
  });

  describe("Action Classification & Greeting + Action Combination", () => {
    const actionInputs = [
      "یارتریدر رو چک کن",
      "یار تریدر رو بررسی کن",
      "YarTrader رو بررسی کن",
      "برو یارتریدر رو ببین",
      "سرور رو چک کن",
      "سایت املاک باشی رو بررسی کن",
    ];

    for (const text of actionInputs) {
      it(`should classify "${text}" as ACTION`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("ACTION");
        expect(result).not.toHaveProperty("resolvedToolId");
        expect(result).not.toHaveProperty("resolvedCapability");
      });
    }

    const greetingWithActionInputs = [
      "سلام، یارتریدر رو بررسی کن",
      "درود، سرور رو چک کن",
      "سلام، برو سایت املاک باشی رو ببین",
    ];

    for (const text of greetingWithActionInputs) {
      it(`should classify greeting + action input "${text}" as ACTION`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("ACTION");
      });
    }
  });

  describe("Entity-Only Input Fail-Closed to AMBIGUOUS", () => {
    const entityOnlyInputs = [
      "یارتریدر",
      "یار تریدر",
      "YarTrader",
      "سرور",
      "املاک باشی",
      "سایت چیست؟",
      "اطلاعات چیست؟",
      "من درباره سایت سؤال دارم",
    ];

    for (const text of entityOnlyInputs) {
      it(`should classify entity-only or broad question "${text}" as AMBIGUOUS`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("AMBIGUOUS");
      });
    }
  });

  describe("Technical & Engineering Vocabulary Knowledge", () => {
    it("should contain standard technical and agent concepts in OperatorKnowledgeBase", () => {
      const sampleConcepts = [
        "architecture",
        "bug",
        "root cause",
        "repository",
        "pull request",
        "logs",
        "fail closed",
        "approval",
      ];

      for (const concept of sampleConcepts) {
        expect(OperatorKnowledgeBase.technicalConcepts).toContain(concept);
      }
    });
  });

  describe("Brain Contract Guarantees", () => {
    it("should strictly return BrainResult matching contract structure without side effects", () => {
      const input: BrainInput = { rawCommandText: "سلام" };
      const result = brain.interpret(input);

      expect(result).toHaveProperty("intent");
      expect(["CONVERSATION", "ACTION", "AMBIGUOUS"]).toContain(result.intent);
    });
  });
});
