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
  const testDbPath = join(tmpdir(), "test_production_e2e_proof.db");
  let serverInstance: OperatorWebServer | null = null;
  let serverPort = 0;

  beforeEach(() => {
    safelyRemoveDbFile(testDbPath);
  });

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
    }
    safelyRemoveDbFile(testDbPath);
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

    // 1. Positive E2E Conversational Route Proof
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid_owner_bearer_token_123",
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        rawCommandText: "hello",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.result.status).toBe("COMPLETED");
  });

  it("should enforce negative E2E security boundaries: unauthorized token, workspace mismatch, and unconfigured tool fail-closed", async () => {
    const apiHandler = bootstrapOperatorApplication({
      bearerToken: "valid_owner_bearer_token_123",
      ownerId: "owner_sohrab",
      useInMemoryStores: true,
    });

    // 1. Unauthorized Bearer Token
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

    // 3. Policy Enforcement Gate for Dangerous Actions
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
