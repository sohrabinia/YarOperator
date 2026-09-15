import { describe, it, expect } from "vitest";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { BrainInput } from "../src/core/contracts/index.js";

describe("DeterministicBrain M1 Intelligence Capabilities", () => {
  const brain = new DeterministicBrain();

  describe("Conversation Classification & Replies", () => {
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

  describe("Action Classification", () => {
    const actionInputs = [
      "برو سایت X را بررسی کن",
      "اطلاعات X را پیدا کن",
      "این سایت را بررسی کن",
      "این کار را انجام بده",
    ];

    for (const text of actionInputs) {
      it(`should classify "${text}" as ACTION without executing anything`, () => {
        const input: BrainInput = { rawCommandText: text };
        const result = brain.interpret(input);

        expect(result.intent).toBe("ACTION");
        // BrainResult strictly does not contain execution target or tool ID
        expect(result).not.toHaveProperty("resolvedToolId");
        expect(result).not.toHaveProperty("resolvedCapability");
        expect(result).not.toHaveProperty("targetCapability");
        expect(result).not.toHaveProperty("requestedToolId");
      });
    }
  });

  describe("Ambiguity & Safety Fail-Closed", () => {
    it("should classify unknown / unsupported natural language input as AMBIGUOUS", () => {
      const input: BrainInput = {
        rawCommandText: "کمی فلسفه در مورد سیب سخن بگو",
      };
      const result = brain.interpret(input);

      expect(result.intent).toBe("AMBIGUOUS");
      expect(result).not.toHaveProperty("resolvedToolId");
      expect(result).not.toHaveProperty("resolvedCapability");
    });

    it("should handle empty or whitespace input safely as AMBIGUOUS", () => {
      const input: BrainInput = { rawCommandText: "   " };
      const result = brain.interpret(input);

      expect(result.intent).toBe("AMBIGUOUS");
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
