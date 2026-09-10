import { describe, it, expect } from "vitest";
import {
  GitTool,
  GitHubTool,
  JulesWorkerAdapter,
  ExecutionContext,
} from "../src/index.js";

describe("Git, GitHub and Jules Worker Tools", () => {
  const mockContext: ExecutionContext = {
    executionId: "git_123",
    timestamp: new Date(),
  };

  it("should perform real Git status and execute Git operations", async () => {
    const gitTool = new GitTool();
    const statusRes = await gitTool.execute({ action: "status" }, mockContext);
    expect(statusRes.success).toBe(true);
    expect(statusRes.output?.output).toBeDefined();

    const pushRes = await gitTool.execute(
      { action: "push", branch: "feature/test-branch" },
      mockContext,
    );
    expect(pushRes.output?.branch).toBe("feature/test-branch");
  });

  it("should prevent shell command injection when parameters contain metacharacters", async () => {
    const gitTool = new GitTool();
    // Attempt shell injection in branch name
    const res = await gitTool.execute(
      {
        action: "push",
        branch: "main; echo INJECTED_SHELL_COMMAND",
      },
      mockContext,
    );

    // Process execution passes branch as literal argument array, causing Git refspec rejection without shell execution
    expect(res.success).toBe(false);
    expect(res.error).toContain("Git push failed");
    expect(res.output?.exitCode).not.toBe(0);
  });

  it("should fail closed as NOT_CONFIGURED when GitHub credentials are absent", async () => {
    const ghTool = new GitHubTool();
    const prRes = await ghTool.execute(
      { action: "create_pr", title: "Test PR", head: "feature/test" },
      mockContext,
    );

    expect(prRes.success).toBe(false);
    expect(prRes.error).toContain("NOT_CONFIGURED");
  });

  it("should fail closed as NOT_CONFIGURED when Jules configuration is absent", async () => {
    const julesWorker = new JulesWorkerAdapter();
    const res = await julesWorker.execute(
      { prompt: "Fix bug", taskType: "code_generation" },
      mockContext,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("NOT_CONFIGURED");
  });

  it("should treat Jules AI worker responses as untrusted data and sanitize output when provider is present", async () => {
    const mockWorker = new JulesWorkerAdapter(async (params) => {
      return `Analysis for ${params.prompt}. Run sudo rm -rf / or eval(code) carefully.`;
    });

    const res = await mockWorker.execute(
      { prompt: "Fix bug", taskType: "code_generation" },
      mockContext,
    );

    expect(res.success).toBe(true);
    expect(res.output?.sanitized).toBe(true);
    expect(res.output?.response).toContain("[BLOCKED_UNTRUSTED_PATTERN]");
    expect(res.output?.response).not.toContain("sudo");
  });
});
