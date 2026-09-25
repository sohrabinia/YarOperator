import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProductionServer } from "../src/web/index.js";
import { OperatorWebServer } from "../src/web/server.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
          rawCommandText: "check operator runtime health",
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

  it("2. Browser command payload uses the canonical yartrader workspace", async () => {
    const appJs = await readFile(
      new URL("../src/web/public/app.js", import.meta.url),
      "utf8",
    );

    expect(appJs).toContain('workspaceId: "yartrader"');
    expect(appJs).not.toContain('workspaceId: "default"');
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

  describe("Production Resource Registry Security Boundaries (Tests A-E)", () => {
    let tempDir: string;
    let origEnv: string | undefined;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "web_reg_test_"));
      origEnv = process.env.OPERATOR_RESOURCES_PATH;
    });

    afterEach(() => {
      if (origEnv !== undefined) {
        process.env.OPERATOR_RESOURCES_PATH = origEnv;
      } else {
        delete process.env.OPERATOR_RESOURCES_PATH;
      }
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it("Test A — Production without explicit OPERATOR_RESOURCES_PATH fails closed and does NOT select config/resources.example.json", async () => {
      delete process.env.OPERATOR_RESOURCES_PATH;

      const res = await createProductionServer({
        port: 0,
        host: "127.0.0.1",
      });
      server = res.server;
      const port = res.port;

      const healthRes = await fetch(`http://127.0.0.1:${port}/readiness`);
      expect(healthRes.status).toBe(503);
      const healthData = await healthRes.json();
      expect(healthData.readiness.status).toBe("NOT_READY");
      expect(healthData.readiness.subsystems.resourceRegistry).toBe(false);
    });

    it("Test B — Production with valid explicit OPERATOR_RESOURCES_PATH succeeds and becomes READY", async () => {
      const validConfigPath = path.join(tempDir, "valid_resources.json");
      const validConfig = {
        defaultWorkspaceId: "ws1",
        workspaces: [
          {
            workspaceId: "ws1",
            allowedRoots: [tempDir],
          },
        ],
      };
      fs.writeFileSync(validConfigPath, JSON.stringify(validConfig), "utf-8");
      process.env.OPERATOR_RESOURCES_PATH = validConfigPath;

      const res = await createProductionServer({
        port: 0,
        host: "127.0.0.1",
      });
      server = res.server;
      const port = res.port;

      const healthRes = await fetch(`http://127.0.0.1:${port}/readiness`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.readiness.status).toBe("READY");
      expect(healthData.readiness.subsystems.resourceRegistry).toBe(true);
    });

    it("Test C — Prove presence of config/resources.example.json on disk does NOT cause Production startup to become READY when OPERATOR_RESOURCES_PATH is absent", async () => {
      delete process.env.OPERATOR_RESOURCES_PATH;

      // Verify config/resources.example.json actually exists on disk in current repo root
      const examplePath = path.resolve("config/resources.example.json");
      expect(fs.existsSync(examplePath)).toBe(true);

      const res = await createProductionServer({
        port: 0,
        host: "127.0.0.1",
      });
      server = res.server;
      const port = res.port;

      const healthRes = await fetch(`http://127.0.0.1:${port}/readiness`);
      expect(healthRes.status).toBe(503);
      const healthData = await healthRes.json();
      expect(healthData.readiness.status).toBe("NOT_READY");
      expect(healthData.readiness.subsystems.resourceRegistry).toBe(false);
    });

    it("Test D — Explicit invalid/malformed Registry yields NOT_READY without fallback to resources.example.json", async () => {
      const malformedConfigPath = path.join(tempDir, "malformed.json");
      fs.writeFileSync(malformedConfigPath, "{ malformed json...", "utf-8");
      process.env.OPERATOR_RESOURCES_PATH = malformedConfigPath;

      const res = await createProductionServer({
        port: 0,
        host: "127.0.0.1",
      });
      server = res.server;
      const port = res.port;

      const healthRes = await fetch(`http://127.0.0.1:${port}/readiness`);
      expect(healthRes.status).toBe(503);
      const healthData = await healthRes.json();
      expect(healthData.readiness.status).toBe("NOT_READY");
      expect(healthData.readiness.subsystems.resourceRegistry).toBe(false);
    });

    it("Test E — Explicit valid Registry + failing audit persistence yields NOT_READY fail-closed", async () => {
      const validConfigPath = path.join(tempDir, "valid_resources.json");
      const validConfig = {
        defaultWorkspaceId: "ws1",
        workspaces: [
          {
            workspaceId: "ws1",
            allowedRoots: [tempDir],
          },
        ],
      };
      fs.writeFileSync(validConfigPath, JSON.stringify(validConfig), "utf-8");

      const failingAuditStore = {
        save: async () => {
          throw new Error("Audit database write failed");
        },
        query: async () => [],
      };

      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        auditStore: failingAuditStore as any,
        resourcesPath: validConfigPath,
      });

      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.statusCode).toBe(503);
      expect(readinessRes.body.readiness.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        false,
      );
    });
  });
});
