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

  it("should perform Git status and push operations", async () => {
    const gitTool = new GitTool();
    const statusRes = await gitTool.execute({ action: "status" }, mockContext);
    expect(statusRes.success).toBe(true);
    expect(statusRes.output?.output).toContain("working tree clean");

    const pushRes = await gitTool.execute(
      { action: "push", branch: "feature/phase-06" },
      mockContext,
    );
    expect(pushRes.success).toBe(true);
    expect(pushRes.output?.branch).toBe("feature/phase-06");
  });

  it("should manage GitHub PR lifecycle actions", async () => {
    const ghTool = new GitHubTool();
    const prRes = await ghTool.execute(
      { action: "create_pr", title: "Test PR" },
      mockContext,
    );

    expect(prRes.success).toBe(true);
    expect(prRes.output?.prNumber).toBeGreaterThan(0);
    expect(prRes.output?.status).toBe("OPEN");
  });

  it("should treat Jules AI worker responses as untrusted data and sanitize output", async () => {
    const julesWorker = new JulesWorkerAdapter();
    const res = await julesWorker.execute(
      { prompt: "Fix bug", taskType: "code_generation" },
      mockContext,
    );

    expect(res.success).toBe(true);
    expect(res.output?.sanitized).toBe(true);
    expect(res.output?.response).toBeDefined();
  });
});
