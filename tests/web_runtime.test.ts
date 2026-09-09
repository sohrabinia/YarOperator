import { describe, it, expect, afterEach } from "vitest";
import { createProductionServer } from "../src/web/index.js";
import { OperatorWebServer } from "../src/web/server.js";

describe("YarOperator Production Web Runtime Entrypoint Test Suite", () => {
  let server: OperatorWebServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("should initialize and start production web server instance on localhost", async () => {
    const res = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
      bearerToken: "test-runtime-token",
    });

    server = res.server;
    const port = res.port;

    expect(server).toBeInstanceOf(OperatorWebServer);
    expect(port).toBeGreaterThan(0);
    expect(server.getHost()).toBe("127.0.0.1");

    // Verify GET /Operator UI Health
    const uiRes = await fetch(`http://127.0.0.1:${port}/Operator`);
    expect(uiRes.status).toBe(200);
    const htmlText = await uiRes.text();
    expect(htmlText).toContain("YarOperator");
    expect(htmlText).toContain("Executive Assistant");

    // Verify POST /api/v1/operator/chat Authenticated API
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

  it("should stop web server cleanly when stopped", async () => {
    const res = await createProductionServer({
      port: 0,
      host: "127.0.0.1",
    });

    server = res.server;
    const port = res.port;

    await server.stop();
    server = null;

    // Subsequent request should fail because server stopped
    await expect(fetch(`http://127.0.0.1:${port}/Operator`)).rejects.toThrow();
  });
});
