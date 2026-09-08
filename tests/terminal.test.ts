import { describe, it, expect, beforeEach } from "vitest";
import { TerminalTool, ExecutionContext } from "../src/index.js";

describe("TerminalTool Operator", () => {
  let terminalTool: TerminalTool;
  const mockContext: ExecutionContext = {
    executionId: "term_123",
    timestamp: new Date(),
  };

  beforeEach(() => {
    terminalTool = new TerminalTool();
  });

  it("should execute allowed command and return stdout", async () => {
    const result = await terminalTool.execute(
      { command: `node -e "console.log(\\"hello world\\")"` },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(result.output?.stdout.trim()).toBe("hello world");
    expect(result.output?.exitCode).toBe(0);
  });

  it("should block dangerously destructive commands", async () => {
    const result = await terminalTool.execute(
      { command: "rm -rf /" },
      mockContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked unsafe terminal command");
  });

  it("should redact sensitive token/key patterns from output", async () => {
    const result = await terminalTool.execute(
      { command: `node -e "console.log(\\"API_KEY=secret_12345\\")"` },
      mockContext,
    );
    expect(result.success).toBe(true);
    expect(result.output?.stdout).toContain("API_KEY=[REDACTED]");
    expect(result.output?.stdout).not.toContain("secret_12345");
  });

  it("should enforce command execution timeout", async () => {
    const result = await terminalTool.execute(
      { command: `node -e "setTimeout(() => {}, 2000)"`, timeoutMs: 200 },
      mockContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
