import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkflowEngine,
  WorkflowValidator,
  WorkflowDefinition,
  ExecutionEngine,
  ToolRegistry,
  AuditLogger,
  Tool,
  ExecutionContext,
} from "../src/index.js";

describe("WorkflowEngine Operator", () => {
  let registry: ToolRegistry;
  let auditLogger: AuditLogger;
  let executionEngine: ExecutionEngine;
  let workflowEngine: WorkflowEngine;

  const mockContext: ExecutionContext = {
    executionId: "wf_123",
    timestamp: new Date(),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    auditLogger = new AuditLogger();
    executionEngine = new ExecutionEngine(registry, auditLogger);
    workflowEngine = new WorkflowEngine(executionEngine, auditLogger);

    const step1Tool: Tool = {
      metadata: {
        id: "step1_tool",
        name: "S1",
        description: "S1",
        safetyLevel: "SAFE",
      },
      execute: async () => ({ success: true, output: { data: "from_step_1" } }),
    };

    const step2Tool: Tool = {
      metadata: {
        id: "step2_tool",
        name: "S2",
        description: "S2",
        safetyLevel: "SAFE",
      },
      execute: async (params: any) => ({
        success: true,
        output: { received: params.prevData },
      }),
    };

    registry.register(step1Tool);
    registry.register(step2Tool);
  });

  it("should validate and execute DAG workflow sequentially with mapped outputs", async () => {
    const wf: WorkflowDefinition = {
      id: "valid_wf",
      name: "Valid Workflow",
      steps: [
        { id: "s1", toolId: "step1_tool", params: {} },
        {
          id: "s2",
          toolId: "step2_tool",
          dependsOn: ["s1"],
          params: (prevOutputs) => ({ prevData: (prevOutputs.s1 as any).data }),
        },
      ],
    };

    const res = await workflowEngine.executeWorkflow(wf, mockContext);
    expect(res.success).toBe(true);
    expect((res.stepResults.s2 as any).received).toBe("from_step_1");
  });

  it("should detect cyclic dependencies in workflow definition", () => {
    const cyclicWf: WorkflowDefinition = {
      id: "cyclic_wf",
      name: "Cyclic",
      steps: [
        { id: "a", toolId: "step1_tool", dependsOn: ["b"], params: {} },
        { id: "b", toolId: "step1_tool", dependsOn: ["a"], params: {} },
      ],
    };

    const validation = WorkflowValidator.validate(cyclicWf);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Cyclic dependency");
  });

  it("should detect missing dependent steps in workflow definition", () => {
    const missingDepWf: WorkflowDefinition = {
      id: "missing_dep",
      name: "Missing Dep",
      steps: [
        {
          id: "step_x",
          toolId: "step1_tool",
          dependsOn: ["non_existent"],
          params: {},
        },
      ],
    };

    const validation = WorkflowValidator.validate(missingDepWf);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("missing step");
  });
});
