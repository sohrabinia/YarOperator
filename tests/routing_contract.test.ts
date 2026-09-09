import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OperatorWebServer } from "../src/web/server.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";

describe("Production Routing Contract Validation Test Suite", () => {
  let server: OperatorWebServer;
  let serverPort: number;
  const BEARER_TOKEN = "routing_test_token_123";

  beforeAll(async () => {
    const apiHandler = bootstrapOperatorApplication({
      ownerId: "owner_sohrab",
      bearerToken: BEARER_TOKEN,
    });

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler,
      googleClientId: "test_client_id_routing.apps.googleusercontent.com",
    });

    serverPort = await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("A. /Operator reaches YarOperator Node server (HTTP 200)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/Operator`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("YarOperator");
  });

  it("B. /app.css reaches YarOperator static assets (HTTP 200)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("C. /app.js reaches YarOperator static assets (HTTP 200)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  it("D. /api/v1/operator/chat reaches Operator API (HTTP 200 with Bearer Token, preserves Authorization header)", async () => {
    const res = await fetch(
      `http://127.0.0.1:${serverPort}/api/v1/operator/chat?param=test_query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BEARER_TOKEN}`,
        },
        body: JSON.stringify({
          workspaceId: "yartrader",
          rawCommandText: "وضعیت سیستم",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it("E. /auth/google reaches OIDC init (HTTP 302 OAuth Redirect)", async () => {
    const res = await fetch(
      `http://127.0.0.1:${serverPort}/auth/google?utm_source=test`,
      {
        redirect: "manual",
      },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeDefined();
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth");
  });

  it("F. /auth/google/callback reaches OIDC callback and processes state/code query params", async () => {
    const res = await fetch(
      `http://127.0.0.1:${serverPort}/auth/google/callback?code=test_code&state=invalid_state`,
    );
    expect(res.status).toBe(400); // Invalid state handled by callback logic
    const text = await res.text();
    expect(text).toContain("Invalid or expired state");
  });

  it("G. /auth/me reaches session endpoint (HTTP 200)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/auth/me`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.authenticated).toBe(false);
  });

  it("H. /auth/logout reaches logout endpoint (HTTP 200)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/auth/logout`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it("I. web.config contains valid IIS URL Rewrite rules mapping /auth/* to :3000 and catch-all to :8000", () => {
    const webConfigPath = path.resolve(__dirname, "../web.config");
    expect(fs.existsSync(webConfigPath)).toBe(true);

    const content = fs.readFileSync(webConfigPath, "utf-8");
    expect(content).toContain('rule name="YarOperator UI Route"');
    expect(content).toContain('rule name="YarOperator Static Assets"');
    expect(content).toContain('rule name="YarOperator API Route"');
    expect(content).toContain('rule name="YarOperator Auth Route"');
    expect(content).toContain('rule name="YarTrader Catch-All Route"');

    expect(content).toContain('url="http://127.0.0.1:3000/auth/{R:1}"');
    expect(content).toContain('url="http://127.0.0.1:8000/{R:1}"');
    expect(content).toContain('appendQueryString="true"');
  });
});
