import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/core/registry/index.js";
import { PolicyEngine } from "../src/core/policy/index.js";
import { TerminalTool } from "../src/core/terminal/index.js";
import { GitTool, GitHubTool } from "../src/core/git/index.js";
import { BrowserTool } from "../src/core/browser/index.js";
import { WebResearchTool } from "../src/core/research/index.js";

describe("Phase 4: Tool Registry Reconstruction & Integrity Verification", () => {
  it("1. tool registry is deterministically reconstructed on startup without mutable state drift", () => {
    const setupRegistry = () => {
      const registry = new ToolRegistry();
      const policyEngine = new PolicyEngine();

      const defaultTools = [
        new TerminalTool(),
        new GitTool(),
        new GitHubTool(),
        new BrowserTool(),
        new WebResearchTool(),
      ];

      for (const t of defaultTools) {
        registry.register(t);
      }

      policyEngine.setRule("browser_operate:navigate", "SAFE");
      policyEngine.setRule("terminal_execute:run", "APPROVAL_REQUIRED");
      policyEngine.setRule("github_operate:merge_pr", "BLOCKED");

      return { registry, policyEngine };
    };

    const run1 = setupRegistry();
    const run2 = setupRegistry();

    expect(run1.registry.list().map((t) => t.metadata.id)).toEqual(
      run2.registry.list().map((t) => t.metadata.id),
    );

    expect(run2.policyEngine.getRule("browser_operate:navigate")).toBe("SAFE");
    expect(run2.policyEngine.getRule("terminal_execute:run")).toBe(
      "APPROVAL_REQUIRED",
    );
    expect(run2.policyEngine.getRule("github_operate:merge_pr")).toBe(
      "BLOCKED",
    );
  });

  it("2. rejecting duplicate tool registration prevents state corruption", () => {
    const registry = new ToolRegistry();
    const tool = new TerminalTool();

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(
      "Tool with ID 'terminal_execute' is already registered.",
    );
  });

  it("3. unknown tool query returns undefined without privilege escalation", () => {
    const registry = new ToolRegistry();
    const policyEngine = new PolicyEngine();

    expect(registry.get("unknown_tool")).toBeUndefined();
    expect(policyEngine.getRule("unknown_tool")).toBeUndefined();
  });
});
