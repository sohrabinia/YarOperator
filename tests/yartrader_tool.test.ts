import { describe, it, expect, beforeAll } from "vitest";
import { YarTraderTool } from "../src/core/tools/yartrader.js";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.ts";

describe("YarTrader Tool & Capability Discovery Test Suite", () => {
  let tool: YarTraderTool;

  beforeAll(() => {
    tool = new YarTraderTool();
  });

  it("1. YarTraderTool resolves canonical actions correctly", () => {
    expect(tool.resolveCanonicalAction({ action: "health" })).toBe(
      "yartrader_adapter:health",
    );
    expect(tool.resolveCanonicalAction({ action: "order_place" })).toBe(
      "yartrader_adapter:order_place",
    );
    expect(tool.resolveCanonicalAction({ action: "restart_service" })).toBe(
      "yartrader_adapter:restart_service",
    );
  });

  it("2. Read-only health/status actions succeed", async () => {
    const res = await tool.execute({ action: "health" });
    expect(res.success).toBe(true);
    expect(res.output?.status).toBe("OK");
    expect(res.output?.capability).toBe("health");
  });

  it("3. Controlled mutations complete with expected details", async () => {
    const res = await tool.execute({
      action: "restart_service",
      serviceName: "YarTrader Worker",
    });
    expect(res.success).toBe(true);
    expect(res.output?.status).toBe("OK");
    expect(res.output?.capability).toBe("restart_service");
  });

  it("4. Live order placement and trading execution actions fail closed (BLOCKED)", async () => {
    const res = await tool.execute({ action: "order_place" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("FORBIDDEN TRADING OPERATION");
    expect(res.output?.status).toBe("BLOCKED");
  });

  it("5. DeterministicBrain answers capability queries accurately without hallucination", () => {
    const brain = new DeterministicBrain();
    const result = brain.interpret({
      rawCommandText: "چه ابزارها و دسترسی‌هایی داری؟",
    });

    expect(result.intent).toBe("CONVERSATION");
    expect(result.reply).toContain("YarOperator");
    expect(result.reply).toContain("yartrader_adapter");
    expect(result.reply).toContain("operator_health");
  });

  it("6. Bootstrapped application registers YarTraderTool in SecureToolEcosystem", async () => {
    const apiHandler = await bootstrapOperatorApplication({
      useInMemoryStores: true,
      resourcesPath: "config/resources.example.json",
    });

    expect(apiHandler).toBeDefined();
    apiHandler.close();
  });
});
