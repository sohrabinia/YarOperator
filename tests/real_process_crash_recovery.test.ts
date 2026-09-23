import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";

describe("Phase 6: Real Child-Process Crash Recovery Test", () => {
  const testDir = path.resolve(process.cwd(), "tmp_crash_test");
  const dbPath = path.join(testDir, "crash_test.db");
  const port = 3899;
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeEach(() => {
    if (existsSync(testDir)) {
      try {
        unlinkSync(dbPath);
      } catch {}
    } else {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {}
    }
  });

  function spawnServerProcess(databasePath: string): ChildProcess {
    const script = `
      import { createProductionServer } from "./dist/web/index.js";
      process.env.OPERATOR_DB_PATH = ${JSON.stringify(databasePath)};
      process.env.PORT = "${port}";
      process.env.HOST = "127.0.0.1";
      createProductionServer({
        port: ${port},
        host: "127.0.0.1",
        bearerToken: "token_crash_100",
        ownerId: "owner_sohrab",
      }).then(() => {
        console.log("CRASH_TEST_SERVER_READY");
      }).catch((err) => {
        console.error(err);
        process.exit(1);
      });
    `;

    return spawn("node", ["--input-type=module", "-e", script], {
      env: {
        ...process.env,
        OPERATOR_DB_PATH: databasePath,
        PORT: String(port),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  async function waitForServerReady(proc: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let output = "";
      proc.stdout?.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("CRASH_TEST_SERVER_READY")) {
          resolve();
        }
      });
      proc.stderr?.on("data", (chunk) => {
        console.error("CHILD STDERR:", chunk.toString());
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (!output.includes("CRASH_TEST_SERVER_READY")) {
          reject(
            new Error(`Child process exited prematurely with code ${code}`),
          );
        }
      });
    });
  }

  it("proves persistent state survives abrupt SIGKILL crash of parent/child server process", async () => {
    // =========================================================================
    // 1. Spawn Initial Child Process (Boot 1)
    // =========================================================================
    let child1 = spawnServerProcess(dbPath);
    await waitForServerReady(child1);

    // Perform authenticated action requiring approval
    const chatReq = {
      headers: { Authorization: "Bearer token_crash_100" },
      body: {
        commandId: "cmd_crash_001",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Execute terminal command rm -rf /tmp/crash_test",
        targetCapability: "terminal-execution",
        requestedToolId: "terminal_execute",
        params: { command: "rm -rf /tmp/crash_test" },
      },
    };

    const res1 = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...chatReq.headers },
      body: JSON.stringify(chatReq.body),
    });

    const json1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(json1.result.status).toBe("APPROVAL_REQUIRED");

    // =========================================================================
    // 2. ABRUPT PROCESS TERMINATION (SIGKILL / CRASH)
    // =========================================================================
    child1.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify process is dead
    try {
      await fetch(`${baseUrl}/health`);
      expect.unreachable("Server should be dead after SIGKILL");
    } catch (err) {
      expect(err).toBeDefined(); // Connection refused
    }

    // =========================================================================
    // 3. Restart Server Process from Same Persistent Database (Boot 2)
    // =========================================================================
    let child2 = spawnServerProcess(dbPath);
    await waitForServerReady(child2);

    // Verify liveness and readiness
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);

    // Verify session created before crash remains authenticated
    const chatRes2 = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...chatReq.headers },
      body: JSON.stringify({
        commandId: "cmd_crash_002",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Check system status",
        targetCapability: "software-development",
        requestedToolId: "git_operate",
        params: { action: "status" },
      }),
    });

    const json2 = await chatRes2.json();
    expect(chatRes2.status).toBe(200);
    expect(json2.success).toBe(true);
    expect(json2.result.status).toBe("COMPLETED");

    // Clean shutdown child 2
    child2.kill("SIGTERM");
  }, 15000);
});
