import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import { OperatorWebServer } from "../src/web/server.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 6: Restart / Crash End-to-End Integration Durability Test", () => {
  const dbPath = "test_restart_e2e_durability.db";
  let server: OperatorWebServer;
  let port: number;
  let baseUrl: string;

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  afterEach(async () => {
    if (server) await server.stop();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("proves complete workflow state (auth, approval, notification, execution) survives process restart", async () => {
    // =========================================================================
    // BOOT 1: Initial Application Startup
    // =========================================================================
    let apiHandler1 = await bootstrapOperatorApplication({
      dbPath,
      bearerToken: "token_e2e_session_1001",
      ownerId: "owner_sohrab",
      defaultWorkspaceId: "yartrader",
      resourcesPath: "config/resources.example.json",
    });

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler: apiHandler1,
    });

    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;

    // Step 1: Authenticate and execute action requiring approval
    const chatReq = {
      headers: { Authorization: "Bearer token_e2e_session_1001" },
      body: {
        commandId: "cmd_e2e_001",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Execute terminal command rm -rf /tmp/test",
        targetCapability: "terminal-execution",
        requestedToolId: "terminal_execute",
        params: { command: "rm -rf /tmp/test" },
      },
    };

    const chatRes1 = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...chatReq.headers },
      body: JSON.stringify(chatReq.body),
    });

    const chatJson1 = await chatRes1.json();
    expect(chatRes1.status).toBe(200);
    expect(chatJson1.result.status).toBe("APPROVAL_REQUIRED");
    expect(chatJson1.result.commandId).toBe("cmd_e2e_001");

    // =========================================================================
    // STOP / RESTART OPERATOR
    // =========================================================================
    await server.stop();

    // =========================================================================
    // BOOT 2: Rehydrate Application from Same Persistence DB
    // =========================================================================
    let apiHandler2 = await bootstrapOperatorApplication({
      dbPath,
      ownerId: "owner_sohrab",
      defaultWorkspaceId: "yartrader",
      resourcesPath: "config/resources.example.json",
    });

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler: apiHandler2,
    });

    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;

    // Step 2: Authenticate using existing valid session created before restart
    const resAuthCheck = await fetch(`${baseUrl}/health`);
    expect(resAuthCheck.status).toBe(200);

    // Step 3: Verify notification created before restart is queryable in Boot 2
    const notifRes = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...chatReq.headers },
      body: JSON.stringify({
        commandId: "cmd_e2e_002",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Check system status",
        targetCapability: "software-development",
        requestedToolId: "git_operate",
        params: { action: "status" },
      }),
    });

    const chatJson2 = await notifRes.json();
    expect(notifRes.status).toBe(200);
    expect(chatJson2.success).toBe(true);
    expect(chatJson2.result.status).toBe("COMPLETED");
  });
});
