import { describe, it, expect } from "vitest";
import type {
  BrainIntent,
  BrainInput,
  BrainResult,
  BrainRule,
  BrainProvider,
  Brain,
} from "../src/core/contracts/index.js";

describe("Brain Contract Foundation", () => {
  it("supports CONVERSATION and ACTION values for BrainIntent", () => {
    const conversationIntent: BrainIntent = "CONVERSATION";
    const actionIntent: BrainIntent = "ACTION";

    expect(conversationIntent).toBe("CONVERSATION");
    expect(actionIntent).toBe("ACTION");
  });

  it("can represent an incoming Brain request via BrainInput", () => {
    const input: BrainInput = {
      rawCommandText: "Hello YarOperator",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
      environmentId: "production",
      targetCapability: "conversation",
      params: { sample: true },
      timestamp: new Date().toISOString(),
      metadata: { source: "test" },
    };

    expect(input.rawCommandText).toBe("Hello YarOperator");
    expect(input.ownerId).toBe("owner_sohrab");
    expect(input.workspaceId).toBe("yartrader");
    expect(input.targetCapability).toBe("conversation");
  });

  it("can represent a Brain decision via BrainResult", () => {
    const conversationResult: BrainResult = {
      intent: "CONVERSATION",
      reply: "Hello! How can I assist you?",
      confidence: 0.99,
    };

    const actionResult: BrainResult = {
      intent: "ACTION",
      resolvedCapability: "software-development",
      resolvedToolId: "terminal",
      params: { command: "git status" },
      confidence: 0.95,
    };

    expect(conversationResult.intent).toBe("CONVERSATION");
    expect(conversationResult.reply).toBeDefined();
    expect(actionResult.intent).toBe("ACTION");
    expect(actionResult.resolvedToolId).toBe("terminal");
  });

  it("expresses the interpretation boundary without executing tools", async () => {
    class ContractStubBrain implements Brain {
      async interpret(input: BrainInput): Promise<BrainResult> {
        if (input.rawCommandText.includes("hello")) {
          return {
            intent: "CONVERSATION",
            reply: "Hello owner",
          };
        }
        return {
          intent: "ACTION",
          resolvedCapability: "software-development",
        };
      }
    }

    const brain: Brain = new ContractStubBrain();
    const result = await brain.interpret({
      rawCommandText: "hello",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
    });

    expect(result.intent).toBe("CONVERSATION");
    expect(result.reply).toBe("Hello owner");
    expect(
      (brain as unknown as Record<string, unknown>).execute,
    ).toBeUndefined();
    expect(
      (brain as unknown as Record<string, unknown>).toolRegistry,
    ).toBeUndefined();
  });

  it("allows BrainRule and BrainProvider to be independently representable", async () => {
    const rule: BrainRule = {
      id: "rule_valid_owner",
      name: "Valid Owner Rule",
      evaluate: (input: BrainInput) => input.ownerId === "owner_sohrab",
    };

    const provider: BrainProvider = {
      id: "provider_mock",
      name: "Mock Rule Provider",
      process: async (input: BrainInput) => {
        const isValid = await rule.evaluate(input);
        return {
          intent: isValid ? "CONVERSATION" : "ACTION",
          confidence: 1.0,
        };
      },
    };

    const validResult = await provider.process({
      rawCommandText: "hi",
      ownerId: "owner_sohrab",
      workspaceId: "yartrader",
    });

    expect(rule.id).toBe("rule_valid_owner");
    expect(provider.id).toBe("provider_mock");
    expect(validResult.intent).toBe("CONVERSATION");
  });
});
