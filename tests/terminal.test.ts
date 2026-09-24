import { describe, it, expect, beforeEach } from "vitest";
import { TerminalTool, ExecutionContext } from "../src/index.js";
import { ResourceRegistry } from "../src/core/registry/resource.js";
import { ResourceResolver } from "../src/core/registry/resolver.js";

describe("TerminalTool Operator", () => {
  let terminalTool: TerminalTool;
  const testRegistry = new ResourceRegistry({
    workspaces: [
      {
        workspaceId: "ws_default",
        allowedRoots: [process.cwd()],
      },
    ],
  });
  const testResolver = new ResourceResolver(testRegistry);

  const mockContext: ExecutionContext = {
    executionId: "term_123",
    timestamp: new Date(),
    workspaceId: "ws_default",
    metadata: { resourceResolver: testResolver },
  };

  beforeEach(() => {
    terminalTool = new TerminalTool(testResolver);
  });

  it("should execute allowed command and return stdout", async () => {
    const result = await terminalTool.execute(
      { command: "node", args: ["-e", 'console.log("hello world")'] },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(result.output?.stdout.trim()).toBe("hello world");
    expect(result.output?.exitCode).toBe(0);
  });

  it("should block dangerously destructive commands", async () => {
    const result = await terminalTool.execute(
      { command: "rm", args: ["-rf", "/"] },
      mockContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked unsafe terminal executable");
  });

  it("should redact sensitive token/key patterns from output", async () => {
    const result = await terminalTool.execute(
      { command: "node", args: ["-e", 'console.log("API_KEY=secret_12345")'] },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(result.output?.stdout).toContain("API_KEY=[REDACTED]");
    expect(result.output?.stdout).not.toContain("secret_12345");
  });

  it("should enforce command execution timeout", async () => {
    const result = await terminalTool.execute(
      {
        command: "node",
        args: ["-e", "setTimeout(() => {}, 2000)"],
        timeoutMs: 200,
      },
      mockContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
