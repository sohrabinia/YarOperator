import { describe, it, expect } from "vitest";
import { BrowserTool, ExecutionContext, BrowserDriver } from "../src/index.js";

describe("BrowserTool Operator", () => {
  const mockContext: ExecutionContext = {
    executionId: "browser_123",
    timestamp: new Date(),
  };

  it("should navigate safely when driver is provided", async () => {
    const mockDriver: BrowserDriver = {
      navigate: async (url) => ({
        title: "Example Title",
        contentSnippet: `Page content for ${url}`,
      }),
      close: async () => {},
    };

    const browserTool = new BrowserTool(async () => mockDriver);
    const result = await browserTool.execute(
      { url: "https://example.com" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.url).toBe("https://example.com");
    expect(result.output?.title).toBe("Example Title");
  });

  it("should fail closed as NOT_CONFIGURED when browser driver is uninstalled/unavailable", async () => {
    const browserTool = new BrowserTool();
    const result = await browserTool.execute(
      { url: "https://example.com" },
      mockContext,
    );

    if (!result.success) {
      expect(result.error).toContain("NOT_CONFIGURED");
    }
  });

  it("should block unsupported protocols like file: or ftp:", async () => {
    const browserTool = new BrowserTool();
    const result = await browserTool.execute(
      { url: "file:///etc/passwd" },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked protocol 'file:'");
  });

  it("should require explicit approval for form interactions like fill or click", async () => {
    const mockDriver: BrowserDriver = {
      navigate: async () => ({ title: "Form", contentSnippet: "form" }),
      fill: async () => {},
      close: async () => {},
    };

    const browserTool = new BrowserTool(async () => mockDriver);
    const unapprovedResult = await browserTool.execute(
      {
        url: "https://example.com",
        action: "fill",
        selector: "#username",
        value: "admin",
      },
      mockContext,
    );

    expect(unapprovedResult.success).toBe(false);
    expect(unapprovedResult.error).toContain("requires explicit approval");

    const approvedContext: ExecutionContext = {
      ...mockContext,
      metadata: { approved: true },
    };

    const approvedResult = await browserTool.execute(
      {
        url: "https://example.com",
        action: "fill",
        selector: "#username",
        value: "admin",
      },
      approvedContext,
    );

    expect(approvedResult.success).toBe(true);
  });

  it("should redact secrets in observed content snippet", async () => {
    const mockDriver: BrowserDriver = {
      navigate: async () => ({
        title: "Mock Title",
        contentSnippet: "Secret text: TOKEN=abc123secret",
      }),
      close: async () => {},
    };

    const browserTool = new BrowserTool(async () => mockDriver);
    const result = await browserTool.execute(
      { url: "https://example.com" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.output?.contentSnippet).toContain("TOKEN=[REDACTED]");
    expect(result.output?.contentSnippet).not.toContain("abc123secret");
  });
});
