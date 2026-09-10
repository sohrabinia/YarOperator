import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProductionServer } from "../src/web/index.ts";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.ts";
import { SQLiteAuditStore } from "../src/core/audit/index.ts";
import { OperatorWebServer } from "../src/web/server.ts";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, existsSync } from "fs";

function safelyRemoveDbFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err: any) {
    if (err && err.code !== "EBUSY" && err.code !== "ENOENT") {
      throw err;
    }
  }
}

describe("YarOperator Production Remediation E2E Proof Suite", () => {
  let testDbPath = "";
  let serverInstance: OperatorWebServer | null = null;
  let serverPort = 0;

  beforeEach(() => {
    testDbPath = join(
      tmpdir(),
      `test_prod_e2e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.db`,
    );
    safelyRemoveDbFile(testDbPath);
  });

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
    }
    if (testDbPath) {
      safelyRemoveDbFile(testDbPath);
    }
  });

  it("should prove real application composition across full HTTP -> Auth -> Owner -> Receiver -> Assistant -> SQLite Audit", async () => {
    const { server, port } = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
      bearerToken: "valid_owner_bearer_token_123",
      ownerId: "owner_sohrab",
      authorizedOwnerEmail: "m.a.sohrabinia@gmail.com",
    });

    serverInstance = server;
    serverPort = port;

    const chatUrl = `http://127.0.0.1:${serverPort}/api/v1/operator/chat`;

    // 1. Positive E2E Real Tool Execution Route Proof (Git Tool Execution)
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid_owner_bearer_token_123",
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Check git status",
        requestedToolId: "git_operate",
        params: { action: "status" },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.result.status).toBe("COMPLETED");
    expect(body.result.resolvedToolId).toBe("git_operate");
    expect(body.result.details?.executedSteps[0].status).toBe("EXECUTED");
    expect(body.result.details?.executedSteps[0].result).toBeDefined();
  });

  it("should enforce negative E2E security boundaries: unauthorized token, workspace mismatch, environment boundary, and policy gates", async () => {
    const apiHandler = bootstrapOperatorApplication({
      bearerToken: "valid_owner_bearer_token_123",
      ownerId: "owner_sohrab",
      useInMemoryStores: true,
    });

    // 1. Unauthorized Bearer Token Gate
    const unauthRes = await apiHandler.handleChatRequest({
      headers: { authorization: "Bearer invalid_token" },
      body: { workspaceId: "yartrader", rawCommandText: "hello" },
    });
    expect(unauthRes.statusCode).toBe(401);
    expect(unauthRes.body.success).toBe(false);

    // 2. Owner Impersonation Gate
    const impersonateRes = await apiHandler.handleChatRequest({
      headers: { authorization: "Bearer valid_owner_bearer_token_123" },
      body: {
        ownerId: "other_owner",
        workspaceId: "yartrader",
        rawCommandText: "hello",
      },
    });
    expect(impersonateRes.statusCode).toBe(403);
    expect(impersonateRes.body.success).toBe(false);

    // 3. Environment Boundary Failure Gate (Unregistered / Mismatched Environment)
    const envBlockRes = await apiHandler.handleChatRequest({
      headers: { authorization: "Bearer valid_owner_bearer_token_123" },
      body: {
        workspaceId: "yartrader",
        environmentId: "invalid_unregistered_environment_999",
        rawCommandText: "Run command in invalid environment",
        requestedToolId: "terminal_execute",
        params: { command: "echo test" },
      },
    });
    expect(envBlockRes.statusCode).toBe(200);
    expect(envBlockRes.body.result?.status).toBe("BLOCKED");

    // 4. Policy Enforcement Gate for Approval-Required / Blocked Actions
    const githubRes = await apiHandler.handleChatRequest({
      headers: { authorization: "Bearer valid_owner_bearer_token_123" },
      body: {
        workspaceId: "yartrader",
        rawCommandText: "Create GitHub PR",
        requestedToolId: "github_operate",
        params: { action: "create_pr", title: "Test", head: "feature" },
      },
    });
    expect(githubRes.statusCode).toBe(200);
    expect(["BLOCKED", "APPROVAL_REQUIRED"]).toContain(
      githubRes.body.result?.status,
    );
  });

  it("should persist audit logs durably in SQLiteAuditStore with secret redaction", async () => {
    const auditStore = new SQLiteAuditStore(testDbPath);
    await auditStore.save({
      id: "evt_test_101",
      type: "ACTION_COMPLETED",
      timestamp: new Date(),
      workspaceId: "yartrader",
      taskId: "task_e2e_101",
      severity: "LOW",
      payload: {
        command: "git commit -m 'feat: update'",
        secret: "BEARER_TOKEN=secret_value_12345",
      },
    });

    const queried = await auditStore.query({ taskId: "task_e2e_101" });
    expect(queried.length).toBe(1);
    expect(queried[0].payload.secret).toContain("BEARER_TOKEN=[REDACTED]");
    expect(queried[0].payload.secret).not.toContain("secret_value_12345");

    auditStore.close();
  });
});
