import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperatorWebServer } from "../src/web/server.js";
import { OperatorApiHandler } from "../src/api/operator.js";
import { IdentityStore } from "../src/core/identity/index.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 5: Health and Readiness Endpoints", () => {
  const dbPath = "test_health_readiness.db";
  let identityStore: IdentityStore;
  let server: OperatorWebServer;
  let baseUrl: string;

  beforeEach(async () => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    identityStore = new IdentityStore(dbPath);

    const mockReceiver = {
      receiveCommand: async () => ({ accepted: true }),
    } as any;

    const apiHandler = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStore,
    );

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler,
    });

    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    try {
      identityStore.close();
    } catch {}
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. GET /health returns 200 HEALTHY without leaking sensitive info or mutating state", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.health.status).toBe("HEALTHY");
    expect(typeof body.health.uptimeMs).toBe("number");
    expect(body.health.timestamp).toBeDefined();

    expect((body as any).tokens).toBeUndefined();
    expect((body as any).keys).toBeUndefined();
  });

  it("2. GET /readiness returns 200 READY when dependencies are active", async () => {
    const res = await fetch(`${baseUrl}/readiness`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.readiness.status).toBe("READY");
    expect(body.readiness.subsystems.commandReceiver).toBe(true);
    expect(body.readiness.subsystems.identityStore).toBe(true);
  });

  it("3. GET /readiness returns 503 NOT_READY when database dependency is closed or unhealthy", async () => {
    identityStore.close();

    const res = await fetch(`${baseUrl}/readiness`);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.readiness.status).toBe("NOT_READY");
    expect(body.readiness.subsystems.identityStore).toBe(false);
  });

  it("4. health/readiness endpoints support path aliases", async () => {
    const resHealthAlias = await fetch(`${baseUrl}/api/v1/operator/health`);
    expect(resHealthAlias.status).toBe(200);

    const resReadinessAlias = await fetch(
      `${baseUrl}/api/v1/operator/readiness`,
    );
    expect(resReadinessAlias.status).toBe(200);
  });
});
