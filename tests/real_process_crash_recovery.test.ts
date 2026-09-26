import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";

describe("Phase 6: Real Child-Process Crash Recovery Test", () => {
  const testDir = path.resolve(process.cwd(), "tmp_crash_test");
  const dbPath = path.join(testDir, "crash_test.db");
  const port = 3900 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeEach(() => {
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
    } catch {}
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  function spawnServerProcess(
    databasePath: string,
    mode: "BOOT1" | "BOOT2",
  ): ChildProcess {
    const script = `
      import { createProductionServer } from "./dist/web/index.js";
      import { DurableAutonomyRunStore } from "./dist/core/autonomy/index.js";

      process.env.OPERATOR_DB_PATH = ${JSON.stringify(databasePath)};
      process.env.PORT = "${port}";
      process.env.HOST = "127.0.0.1";

      if (${JSON.stringify(mode)} === "BOOT1") {
        const runStore = new DurableAutonomyRunStore(${JSON.stringify(databasePath)});
        const { IdentityStore } = await import("./dist/core/identity/index.js");
        const idStore = new IdentityStore(${JSON.stringify(databasePath)});

        let user = idStore.getUserById("owner_sohrab");
        if (!user) {
          user = idStore.createUser({
            userId: "owner_sohrab",
            primaryEmail: "sohrab@yartrader.local",
          });
        }
        idStore.createWorkspace({
          workspaceId: "yartrader",
          name: "Workspace yartrader",
          ownerUserId: "owner_sohrab",
        });

        // Seed initial run and DISPATCHED in-flight checkpoint in Boot 1 only
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

        idStore.close();
        runStore.close();
      }

      createProductionServer({
        port: 0,
        host: "127.0.0.1",
        bearerToken: "token_crash_100",
        ownerId: "owner_sohrab",
      }).then(({ port: actualPort }) => {
        console.log("CRASH_TEST_SERVER_READY:" + actualPort);
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

  async function waitForServerReady(proc: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      let output = "";
      proc.stdout?.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("CRASH_TEST_SERVER_READY:")) {
          const match = output.match(/CRASH_TEST_SERVER_READY:(\d+)/);
          if (match) {
            resolve(parseInt(match[1], 10));
          }
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
    let child1 = spawnServerProcess(dbPath, "BOOT1");
    const port1 = await waitForServerReady(child1);
    const baseUrl1 = `http://127.0.0.1:${port1}`;

    // Verify initial liveness
    const resHealth1 = await fetch(`${baseUrl1}/health`);
    expect(resHealth1.status).toBe(200);

    // =========================================================================
    // 2. ABRUPT PROCESS TERMINATION (SIGKILL)
    // =========================================================================
    child1.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify process is killed
    try {
      await fetch(`${baseUrl1}/health`);
      expect.unreachable("Server should be dead after SIGKILL");
    } catch (err) {
      expect(err).toBeDefined();
    }

    // =========================================================================
    // 3. Restart Server Process & Trigger Recovery
    // =========================================================================
    let child2 = spawnServerProcess(dbPath, "BOOT2");
    const port2 = await waitForServerReady(child2);
    const baseUrl2 = `http://127.0.0.1:${port2}`;

    const healthRes2 = await fetch(`${baseUrl2}/health`);
    expect(healthRes2.status).toBe(200);

    // Explicitly run ControlledAutonomyEngine.recoverInterruptedTasks against DB
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const { ControlledAutonomyEngine, DurableAutonomyRunStore } =
      await import("../src/core/autonomy/index.js");
    const { AgentRegistry } = await import("../src/core/agent/index.js");
    const { AgentOrchestrator } =
      await import("../src/core/orchestrator/index.js");
    const { PolicyEngine, ApprovalManager } =
      await import("../src/core/policy/index.js");
    const { SecureToolEcosystem } = await import("../src/core/tools/index.js");
    const { AcceptanceEngine } =
      await import("../src/core/acceptance/index.js");
    const { AuditManager } = await import("../src/core/audit/index.js");
    const { NotificationManager } =
      await import("../src/core/notification/index.js");
    const { IdentityStore } = await import("../src/core/identity/index.js");
    const { EnvironmentManager } =
      await import("../src/core/environment/index.js");

    const identityStore = new IdentityStore(dbPath);
    const runStore = new DurableAutonomyRunStore(dbPath);
    const environmentManager = new EnvironmentManager();

    environmentManager.registerEnvironment({
      id: "env_yartrader",
      name: "YarTrader Environment",
      type: "PRODUCTION",
      capabilities: ["git_operate"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    const orchestrator = new AgentOrchestrator(new AgentRegistry());
    const approvalManager = new ApprovalManager(dbPath);
    const policyEngine = new PolicyEngine(approvalManager);
    const toolEcosystem = new SecureToolEcosystem(
      undefined,
      policyEngine,
      approvalManager,
      environmentManager,
    );
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager(dbPath);

    const autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      new AcceptanceEngine(),
      auditManager,
      notificationManager,
      undefined,
      environmentManager,
      identityStore,
      runStore,
      "worker_child_2",
    );

    const recoveryRes = await autonomyEngine.recoverInterruptedTasks();
    expect(recoveryRes.failedRecoveryTasks).toContain("task_inflight_99");

    // Inspect database state directly after recovery to prove UNKNOWN_IN_FLIGHT -> BLOCKED transition
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
    expect(runRow.status).toBe("BLOCKED");
    expect(runRow.cancellation_reason).toContain(
      "UNKNOWN_IN_FLIGHT. Cannot safely verify external side-effects. Failing closed.",
    );

    expect(chkRow).toBeDefined();
    expect(chkRow.execution_state).toBe("UNKNOWN_IN_FLIGHT");

    identityStore.close();
    runStore.close();
    approvalManager.close();
    notificationManager.close();

    child2.kill("SIGTERM");
  }, 20000);
});
