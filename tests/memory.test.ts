import { describe, it, expect, beforeEach } from "vitest";
import { MemoryManager, DecisionDetails } from "../src/index.js";

describe("MemoryManager Foundation & Workspace Isolation", () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = new MemoryManager();
  });

  it("should create and retrieve SHORT memory records", async () => {
    const mem = await memoryManager.createMemory("SHORT", "Active task focus");
    expect(mem.id).toBeDefined();
    expect(mem.type).toBe("SHORT");

    const retrieved = await memoryManager.getMemory(mem.id);
    expect(retrieved?.content).toBe("Active task focus");
  });

  it("should enforce strict workspace isolation and prevent cross-workspace memory leakage", async () => {
    await memoryManager.createMemory(
      "WORKSPACE",
      "YarTrader Stack: Node ESM",
      "yartrader",
    );
    await memoryManager.createMemory(
      "WORKSPACE",
      "Amlakbashi SEO rule",
      "amlakbashi",
    );

    const yartraderMemories =
      await memoryManager.getWorkspaceMemories("yartrader");
    expect(yartraderMemories.length).toBe(1);
    expect(yartraderMemories[0].content).toContain("YarTrader");

    const amlakbashiMemories =
      await memoryManager.getWorkspaceMemories("amlakbashi");
    expect(amlakbashiMemories.length).toBe(1);
    expect(amlakbashiMemories[0].content).toContain("Amlakbashi");
  });

  it("should support DECISION memory records with structured rationale and lessons", async () => {
    const decision: DecisionDetails = {
      decision: "Use native node:sqlite for persistence",
      reason: "Avoid external DB dependencies and maintain simplicity",
      alternatives: ["PostgreSQL", "MongoDB"],
      outcome: "Successful durable local store",
      lesson: "Abstract storage interfaces for future extensibility",
    };

    const mem = await memoryManager.createMemory(
      "DECISION",
      "SQLite persistence decision",
      "yartrader",
      decision,
    );

    expect(mem.type).toBe("DECISION");
    expect(mem.decisionDetails?.reason).toContain("Avoid external DB");
    expect(mem.decisionDetails?.alternatives).toContain("PostgreSQL");
  });
});
