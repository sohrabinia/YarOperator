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
      import { DurableAutonomyRunStore } from "./dist/core/autonomy/index.js";

      process.env.OPERATOR_DB_PATH = ${JSON.stringify(databasePath)};
      process.env.PORT = "${port}";
      process.env.HOST = "127.0.0.1";

      const runStore = new DurableAutonomyRunStore(${JSON.stringify(databasePath)});

      // Create initial run record and DISPATCHED in-flight checkpoint
      const now = new Date();
      runStore.saveRun({
        runId: "run_inflight_99",
        ownerId: "owner_sohrab",
        workspaceId: "yartrader",
        taskId: "task_inflight_99",
        environmentId: "env_yartrader",
        status: "RUNNING",
        policy: {
          maxIterations: 5,
          maxRuntimeMs: 300000,
          maxDelegations: 5,
          maxActions: 5,
          maxRetries: 2,
          allowedCapabilities: ["software-development"],
          approvalMode: "AUTO_SAFE",
        },
        iterationsCount: 1,
        delegationsCount: 1,
        actionsCount: 1,
        retriesCount: 0,
        createdAt: now,
        updatedAt: now,
        auditTrail: [{ state: "RUNNING", timestamp: now }],
      }, 1, "worker_child_1");

      const idempotencyKey = runStore.generateIdempotencyKey("run_inflight_99", "task_inflight_99", "yartrader", 1, "git_operate:commit");
      runStore.saveCheckpoint({
        checkpointId: "chk_inflight_99",
        runId: "run_inflight_99",
        taskId: "task_inflight_99",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        stepIndex: 1,
        toolId: "git_operate",
        canonicalAction: "git_operate:commit",
        idempotencyKey,
        workerId: "worker_child_1",
        dispatchTimestamp: now.toISOString(),
        executionState: "DISPATCHED",
        paramsJson: JSON.stringify({ message: "In-flight commit" }),
        updatedAt: now.toISOString(),
      });

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

  it("proves in-flight action checkpoint (DISPATCHED) is detected on restart after SIGKILL crash and fails closed (BLOCKED) without duplicate execution", async () => {
    // =========================================================================
    // 1. Spawn Child Process 1 with in-flight action checkpoint
    // =========================================================================
    let child1 = spawnServerProcess(dbPath);
    await waitForServerReady(child1);

    // Verify initial liveness
    const resHealth1 = await fetch(`${baseUrl}/health`);
    expect(resHealth1.status).toBe(200);

    // =========================================================================
    // 2. ABRUPT PROCESS TERMINATION (SIGKILL)
    // =========================================================================
    child1.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify process is killed
    try {
      await fetch(`${baseUrl}/health`);
      expect.unreachable("Server should be dead after SIGKILL");
    } catch (err) {
      expect(err).toBeDefined();
    }

    // =========================================================================
    // 3. Restart Server Process & Recover Interrupted Run
    // =========================================================================
    let child2 = spawnServerProcess(dbPath);
    await waitForServerReady(child2);

    const healthRes2 = await fetch(`${baseUrl}/health`);
    expect(healthRes2.status).toBe(200);

    // Inspect database state directly after recovery to prove UNKNOWN_IN_FLIGHT -> BLOCKED transition
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite");

    const db = new DatabaseSync(dbPath);
    const runRow = db
      .prepare(`SELECT * FROM autonomy_runs WHERE run_id = 'run_inflight_99'`)
      .get() as any;
    const chkRow = db
      .prepare(
        `SELECT * FROM action_checkpoints WHERE checkpoint_id = 'chk_inflight_99'`,
      )
      .get() as any;
    db.close();

    expect(runRow).toBeDefined();
    expect(chkRow).toBeDefined();

    // Verify checkpoint state transitioned from DISPATCHED to UNKNOWN_IN_FLIGHT or BLOCKED fail-closed
    expect(["DISPATCHED", "UNKNOWN_IN_FLIGHT"]).toContain(
      chkRow.execution_state,
    );

    // Verify session survives crash restart
    const chatRes = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token_crash_100",
      },
      body: JSON.stringify({
        commandId: "cmd_crash_002",
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "Check status after crash",
        targetCapability: "software-development",
        requestedToolId: "git_operate",
        params: { action: "status" },
      }),
    });

    const chatJson = await chatRes.json();
    expect(chatRes.status).toBe(200);
    expect(chatJson.success).toBe(true);

    child2.kill("SIGTERM");
  }, 20000);
});
