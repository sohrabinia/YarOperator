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
        "یارتریدر پروژه",
        "اون یار تریدر",
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
        "amlaakbashi",
        "املاک‌باشی",
        "املاک باشی",
        "املاکباشی",
        "سایت املاک‌باشی",
        "سایت املاک باشی",
        "سایت املاکباشی",
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
        "yaroperator",
        "یار اپراتور",
        "یاراپراتور",
        "یار‌اپراتور",
        "اپراتور",
        "یار اوپراتور",
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
      { text: "شب بخیر", expectedSubstring: "سلام" },
      { text: "صبح بخیر", expectedSubstring: "سلام" },
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

  describe("Action Classification & Natural Owner Sentences", () => {
    const naturalOwnerSentences = [
      "سلام، یارتریدر رو یه نگاهی بنداز",
      "ببین یار تریدر چه وضعیه",
      "یارتریدر رو بررسی کن",
      "YarTrader رو چک کن",
      "سلام، سرور رو بررسی کن",
      "وضعیت سرور رو ببین",
      "سرور رو چک کن",
      "برو سایت املاک باشی رو ببین",
      "سایت املاک‌باشی رو بررسی کن",
      "این مشکل رو بررسی کن",
      "ببین مشکل چیه",
      "این باگ رو پیدا کن",
      "این مشکل رو درست کن",
      "باگ رو برطرف کن",
      "کد رو اصلاح کن",
      "تستش کن",
      "ببین درست شده یا نه",
    ];

    for (const text of naturalOwnerSentences) {
      it(`should classify natural sentence "${text}" as ACTION`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("ACTION");
        expect(result).not.toHaveProperty("resolvedToolId");
        expect(result).not.toHaveProperty("resolvedCapability");
      });
    }
  });

  describe("Entity-Only & Isolated Keywords Fail-Closed to AMBIGUOUS", () => {
    const ambiguousInputs = [
      "یارتریدر",
      "YarTrader",
      "سرور",
      "املاک باشی",
      "گیت‌هاب",
      "بررسی",
      "مشکل",
      "سایت چیست؟",
      "اطلاعات چیست؟",
      "من درباره سایت سؤال دارم",
    ];

    for (const text of ambiguousInputs) {
      it(`should classify entity-only or isolated keyword "${text}" as AMBIGUOUS`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("AMBIGUOUS");
      });
    }
  });

  describe("Technical & Engineering Vocabulary (Recognition Only)", () => {
    it("should contain technical concepts without triggering tool resolution or execution", () => {
      const sampleConcepts = [
        "architecture",
        "bug",
        "root cause",
        "repository",
        "pull request",
        "logs",
        "fail closed",
        "approval",
        "server",
      ];

      for (const concept of sampleConcepts) {
        expect(OperatorKnowledgeBase.technicalConcepts).toContain(concept);

        // Negative execution test: isolated concept inputs remain AMBIGUOUS or CONVERSATION
        const input: BrainInput = { rawCommandText: concept };
        const result = brain.interpret(input);

        expect(result).not.toHaveProperty("resolvedToolId");
        expect(result).not.toHaveProperty("resolvedCapability");
        expect(result).not.toHaveProperty("targetCapability");
        expect(result).not.toHaveProperty("requestedToolId");
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
