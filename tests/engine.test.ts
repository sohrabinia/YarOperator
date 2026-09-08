import { describe, it, expect, beforeEach } from "vitest";
import {
  ExecutionEngine,
  ToolRegistry,
  AuditLogger,
  Tool,
  ExecutionContext,
} from "../src/index.js";

describe("ExecutionEngine Core", () => {
  let registry: ToolRegistry;
  let auditLogger: AuditLogger;
  let engine: ExecutionEngine;

  const mockContext: ExecutionContext = {
    executionId: "exec_123",
    timestamp: new Date(),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    auditLogger = new AuditLogger();
    engine = new ExecutionEngine(registry, auditLogger);
  });

  it("should execute a valid registered tool successfully", async () => {
    const echoTool: Tool<{ message: string }, { echoed: string }> = {
      metadata: {
        id: "echo_tool",
        name: "Echo Tool",
        description: "Echoes message",
        safetyLevel: "SAFE",
      },
      execute: async (params) => ({
        success: true,
        output: { echoed: params.message },
      }),
    };

    registry.register(echoTool);

    const result = await engine.execute<
      { message: string },
      { echoed: string }
    >("echo_tool", { message: "hello" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.output?.echoed).toBe("hello");
    expect(engine.getState()).toBe("COMPLETED");

    const events = auditLogger.getEvents("exec_123");
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toContain("STEP_START");
    expect(events.map((e) => e.type)).toContain("STEP_END");
  });

  it("should fail gracefully when executing an unknown tool", async () => {
    const result = await engine.execute("unknown_tool", {}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool 'unknown_tool' not found");
    expect(engine.getState()).toBe("FAILED");
  });

  it("should reject duplicate tool registrations", () => {
    const dummyTool: Tool = {
      metadata: {
        id: "test",
        name: "test",
        description: "test",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true }),
    };

    registry.register(dummyTool);
    expect(() => registry.register(dummyTool)).toThrow("already registered");
  });

  it("should enforce policy evaluations if policyEvaluator is present", async () => {
    const mockTool: Tool = {
      metadata: {
        id: "guarded",
        name: "Guarded Tool",
        description: "guarded",
        safetyLevel: "APPROVAL_REQUIRED",
      },
      execute: async () => ({ success: true }),
    };
    registry.register(mockTool);

    const blockedEngine = new ExecutionEngine(registry, auditLogger, {
      evaluate: async () => ({ allowed: false, reason: "Denied by policy" }),
    });

    const result = await blockedEngine.execute("guarded", {}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Denied by policy");
    expect(blockedEngine.getState()).toBe("FAILED");
  });
});
