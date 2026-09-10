import { describe, it, expect, afterEach } from "vitest";
import { createProductionServer } from "../src/web/index.js";
import { OperatorWebServer } from "../src/web/server.js";

describe("YarOperator Web Runtime Entrypoint Test Suite", () => {
  let server: OperatorWebServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("1. Production server initializes and starts on localhost without hard-coded production secrets", async () => {
    const res = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
      bearerToken: "test-runtime-token",
      ownerId: "owner_sohrab",
    });

    server = res.server;
    const port = res.port;

    expect(server).toBeInstanceOf(OperatorWebServer);
    expect(port).toBeGreaterThan(0);
    expect(server.getHost()).toBe("127.0.0.1");

    // Verify GET /Operator UI Endpoint
    const uiRes = await fetch(`http://127.0.0.1:${port}/Operator`);
    expect(uiRes.status).toBe(200);
    const htmlText = await uiRes.text();
    expect(htmlText).toContain("YarOperator");
    expect(htmlText).toContain("Executive Assistant");

    // Verify POST /api/v1/operator/chat with provided Bearer token
    const apiRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/operator/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-runtime-token",
        },
        body: JSON.stringify({
          rawCommandText: "check status",
          workspaceId: "yartrader",
        }),
      },
    );

    expect(apiRes.status).toBe(200);
    const apiData = await apiRes.json();
    expect(apiData.success).toBe(true);
    expect(apiData.result).toBeDefined();
    expect(apiData.result.accepted).toBe(true);
  });

  it("2. Server stops cleanly when stop() is invoked", async () => {
    const res = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
    });

    server = res.server;
    const port = res.port;

    await server.stop();
    server = null;

    // Requests fail after clean stop
    await expect(fetch(`http://127.0.0.1:${port}/Operator`)).rejects.toThrow();
  });

  it("3. Frontend browser application (app.js) sends canonical workspaceId 'yartrader' and does not send 'default'", async () => {
    const res = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
    });

    server = res.server;
    const port = res.port;

    const jsRes = await fetch(`http://127.0.0.1:${port}/app.js`);
    expect(jsRes.status).toBe(200);
    const jsText = await jsRes.text();

    expect(jsText).toContain('workspaceId: "yartrader"');
    expect(jsText).not.toContain('workspaceId: "default"');
  });
});
