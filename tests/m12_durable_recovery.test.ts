import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, existsSync } from "fs";
import { IdentityStore } from "../src/core/identity/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { SecureToolEcosystem } from "../src/core/tools/index.js";
import { ToolRegistry } from "../src/core/registry/index.js";
import { AcceptanceEngine } from "../src/core/acceptance/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../src/core/workspace/policy.js";
import { DurableOperationalMemory } from "../src/core/memory/index.js";
import {
  Tool,
  ToolMetadata,
  ExecutionContext,
} from "../src/core/contracts/index.js";
import {
  ControlledAutonomyEngine,
  DurableAutonomyRunStore,
  BoundedAutonomyRunConfig,
  AIProposal,
  ActionCheckpoint,
} from "../src/core/autonomy/index.js";

function safelyRemoveDbFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (_err) {}
}

class DummyTool implements Tool {
  public metadata: ToolMetadata;
  public executionCount = 0;

  constructor(
    id: string,
    name: string,
    private handler?: (params: any, context?: ExecutionContext) => Promise<any>,
  ) {
    this.metadata = {
      id,
      name,
      description: "Test tool",
      safetyLevel: "SAFE",
    };
  }

  async execute(params: any, context?: ExecutionContext): Promise<any> {
    this.executionCount++;
    if (this.handler) {
      return this.handler(params, context);
    }
    return { success: true, output: "default_output" };
  }
}

describe("M12 — Durable Operational State & Crash Recovery Test Suite", () => {
  const dbPath = join(
    tmpdir(),
    `test_m12_durable_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.db`,
  );

  beforeEach(() => {
    safelyRemoveDbFile(dbPath);
  });

  afterEach(() => {
    safelyRemoveDbFile(dbPath);
  });

  function setupEnvironment(customDbPath: string = dbPath) {
    const runStore = new DurableAutonomyRunStore(customDbPath);
    const memory = new DurableOperationalMemory(customDbPath);
    const identityStore = new IdentityStore(customDbPath);
    const policyEngine = new PolicyEngine();
    const approvalManager = new ApprovalManager(":memory:");
    const agentRegistry = new AgentRegistry();
    const orchestrator = new AgentOrchestrator(agentRegistry);
    const toolRegistry = new ToolRegistry();
    const environmentManager = new EnvironmentManager();
    const workspacePolicyManager = new WorkspacePolicyManager();
    const toolEcosystem = new SecureToolEcosystem(
      toolRegistry,
      policyEngine,
      approvalManager,
      environmentManager,
      workspacePolicyManager,
    );
    const acceptanceEngine = new AcceptanceEngine();
    const auditManager = new AuditManager();
    const notificationManager = new NotificationManager();

    // Register test user safely if not already present
    try {
      identityStore.createUser({
        userId: "user_owner_1",
        primaryEmail: "owner@yar.org",
      });
    } catch (_err) {}
    try {
      identityStore.createWorkspace({
        workspaceId: "ws_1",
        name: "Workspace 1",
        ownerUserId: "user_owner_1",
      });
    } catch (_err) {}

    // Register environment with tool capabilities
    environmentManager.registerEnvironment({
      id: "env_prod",
      name: "Production Env",
      type: "PRODUCTION",
      capabilities: ["dev-cap", "git_tool", "browser_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "ws_1" },
    });

    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: "ws_1",
        allowedTools: ["git_tool", "browser_tool"],
        allowedRoots: [process.cwd()],
      }),
    );

    // Register tools
    const gitTool = new DummyTool("git_tool", "Git Tool");
    toolRegistry.register(gitTool);
    policyEngine.setRule("git_tool", "SAFE");

    agentRegistry.registerAgent({
      id: "agent_1",
      name: "Agent 1",
      capabilities: ["dev-cap"],
      workspaceScopes: ["ws_1"],
      toolScopes: ["git_tool", "browser_tool"],
      provider: "test-provider",
      model: "test-model",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const engine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      acceptanceEngine,
      auditManager,
      notificationManager,
      memory,
      environmentManager,
      identityStore,
      runStore,
      "worker_1",
    );

    const defaultConfig: BoundedAutonomyRunConfig = {
      runId: "run_m12_1",
      ownerId: "user_owner_1",
      workspaceId: "ws_1",
      taskId: "task_m12_1",
      environmentId: "env_prod",
      policy: {
        maxIterations: 5,
        maxRuntimeMs: 60000,
        maxDelegations: 5,
        maxActions: 5,
        maxRetries: 3,
        allowedCapabilities: ["dev-cap"],
        approvalMode: "AUTO_SAFE",
      },
    };

    return {
      runStore,
      memory,
      identityStore,
      policyEngine,
      approvalManager,
      environmentManager,
      toolRegistry,
      gitTool,
      engine,
      defaultConfig,
    };
  }

  // 1. Crash before dispatch
  it("1. crash before dispatch: should recover run safely when no checkpoint exists", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    // Simulate process crash (engine instance destroyed, DB persists)
    const env2 = setupEnvironment();
    const recovery = await env2.engine.recoverInterruptedTasks();

    expect(recovery.resumedTasks).toContain("task_m12_1");
    const recoveredRun = env2.engine.getRun("run_m12_1");
    expect(recoveredRun?.status).toBe("AUTHORIZED");
  });

  // 2. Crash after durable dispatch checkpoint but before tool call
  it("2. crash after durable dispatch checkpoint: should fail closed to UNKNOWN_IN_FLIGHT / BLOCKED", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    // Manually insert DISPATCHED checkpoint simulating crash mid-dispatch
    const checkpoint: ActionCheckpoint = {
      checkpointId: "chk_crash_2",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_crashed",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "DISPATCHED",
      updatedAt: new Date().toISOString(),
    };
    env1.runStore.saveCheckpoint(checkpoint);

    // Restart process and recover
    const env2 = setupEnvironment();
    const recovery = await env2.engine.recoverInterruptedTasks();

    expect(recovery.failedRecoveryTasks).toContain("task_m12_1");
    const recoveredRun = env2.engine.getRun("run_m12_1");
    expect(recoveredRun?.status).toBe("BLOCKED");
    expect(recoveredRun?.terminalReason).toContain("UNKNOWN_IN_FLIGHT");
  });

  // 3. Crash during tool call
  it("3. crash during tool call: in-flight checkpoint must transition to UNKNOWN_IN_FLIGHT and fail closed", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    env1.runStore.saveCheckpoint({
      checkpointId: "chk_crash_3",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "DISPATCHED",
      updatedAt: new Date().toISOString(),
    });

    const env2 = setupEnvironment();
    await env2.engine.recoverInterruptedTasks();

    const chk = env2.runStore.getCheckpoint("chk_crash_3");
    expect(chk?.executionState).toBe("UNKNOWN_IN_FLIGHT");
  });

  // 4. Crash after tool success but before local completion
  it("4. crash after tool success: EXECUTED checkpoint should be recognized and completed without re-running tool", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    env1.runStore.saveCheckpoint({
      checkpointId: "chk_crash_4",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "EXECUTED",
      executionOutputJson: JSON.stringify({
        success: true,
        output: "already_done",
      }),
      updatedAt: new Date().toISOString(),
    });

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
      isTerminalProposal: true,
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("COMPLETED");
    expect(env1.gitTool.executionCount).toBe(0); // Tool was NOT re-executed!
  });

  // 5. Crash after verification but before terminal state
  it("5. crash after verification: VERIFIED checkpoint completes run without duplicate execution", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    env1.runStore.saveCheckpoint({
      checkpointId: "chk_crash_5",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "VERIFIED",
      executionOutputJson: JSON.stringify({
        success: true,
        output: "verified_output",
      }),
      updatedAt: new Date().toISOString(),
    });

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
      isTerminalProposal: true,
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("COMPLETED");
    expect(env1.gitTool.executionCount).toBe(0);
  });

  // 6. Restart recovery
  it("6. restart recovery: loads incomplete runs from SQLite and restores state", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const env2 = setupEnvironment();
    const rec = await env2.engine.recoverInterruptedTasks();
    expect(rec.recoveredCount).toBe(1);
    expect(env2.engine.getRun("run_m12_1")).toBeDefined();
  });

  // 7. UNKNOWN_IN_FLIGHT handling
  it("7. UNKNOWN_IN_FLIGHT handling: is distinct state from FAILED and is never blindly retried", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    env1.runStore.saveCheckpoint({
      checkpointId: "chk_7",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "UNKNOWN_IN_FLIGHT",
      updatedAt: new Date().toISOString(),
    });

    const env2 = setupEnvironment();
    const rec = await env2.engine.recoverInterruptedTasks();
    expect(rec.failedRecoveryTasks).toContain("task_m12_1");
    expect(env2.engine.getRun("run_m12_1")?.status).toBe("BLOCKED");
  });

  // 8. Verification-before-retry
  it("8. verification-before-retry: existing checkpoint is verified before considering retry", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const key = env1.runStore.generateIdempotencyKey(
      "run_m12_1",
      "task_m12_1",
      "ws_1",
      1,
      "git_tool",
    );
    env1.runStore.saveCheckpoint({
      checkpointId: "chk_8",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: key,
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "EXECUTED",
      executionOutputJson: JSON.stringify({
        success: true,
        output: "valid_checkpoint",
      }),
      updatedAt: new Date().toISOString(),
    });

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
      isTerminalProposal: true,
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("COMPLETED");
  });

  // 9. Verification cannot establish safe result -> BLOCKED
  it("9. verification cannot establish safe result: UNKNOWN_IN_FLIGHT fails closed to BLOCKED", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    env1.runStore.saveCheckpoint({
      checkpointId: "chk_9",
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      environmentId: "env_prod",
      stepIndex: 1,
      toolId: "git_tool",
      canonicalAction: "git_tool",
      idempotencyKey: env1.runStore.generateIdempotencyKey(
        "run_m12_1",
        "task_m12_1",
        "ws_1",
        1,
        "git_tool",
      ),
      workerId: "worker_1",
      dispatchTimestamp: new Date().toISOString(),
      executionState: "DISPATCHED",
      updatedAt: new Date().toISOString(),
    });

    const env2 = setupEnvironment();
    await env2.engine.recoverInterruptedTasks();
    expect(env2.engine.getRun("run_m12_1")?.status).toBe("BLOCKED");
  });

  // 10. Deterministic idempotency key across restart
  it("10. deterministic idempotency key across restart: produces identical key for same step parameters", () => {
    const store1 = new DurableAutonomyRunStore(dbPath);
    const key1 = store1.generateIdempotencyKey(
      "run_1",
      "task_1",
      "ws_1",
      1,
      "git_tool:commit",
    );
    store1.close();

    const store2 = new DurableAutonomyRunStore(dbPath);
    const key2 = store2.generateIdempotencyKey(
      "run_1",
      "task_1",
      "ws_1",
      1,
      "git_tool:commit",
    );
    store2.close();

    expect(key1).toBe("idemp:run_1:task_1:ws_1:1:git_tool:commit");
    expect(key1).toBe(key2);
  });

  // 11. Duplicate dispatch rejection
  it("11. duplicate dispatch rejection: second attempt with same idempotency key rejects duplicate tool execution", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
      isTerminalProposal: false,
    };

    await env1.engine.executeIteration("run_m12_1", proposal);
    expect(env1.gitTool.executionCount).toBe(1);

    // Reset iterationsCount to 0 so next execution targets the same stepIndex 1 (same idempotency key)
    const run = env1.engine.getRun("run_m12_1")!;
    run.iterationsCount = 0;

    // Attempting same step with existing checkpoint uses existing result
    await env1.engine.executeIteration("run_m12_1", proposal);
    expect(env1.gitTool.executionCount).toBe(1); // Not executed twice!
  });

  // 12. Stale worker rejection
  it("12. stale worker rejection: worker without active lease cannot execute or update run", async () => {
    const env1 = setupEnvironment();
    const run = await env1.engine.startRun(env1.defaultConfig);

    // Force lease ownership to belong to active worker_2
    env1.runStore.saveRun(
      run,
      run.iterationsCount,
      "worker_2",
      new Date(Date.now() + 60000).toISOString(),
    );

    // Worker 1 tries to execute iteration
    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("BLOCKED");
    expect(res.terminalReason).toContain("Worker lease");
  });

  // 13. Lease expiry
  it("13. lease expiry: expired lease allows another active worker to acquire lease", () => {
    const store = new DurableAutonomyRunStore(dbPath);
    const runConfig = {
      runId: "run_lease_1",
      ownerId: "user_owner_1",
      workspaceId: "ws_1",
      taskId: "task_1",
      environmentId: "env_prod",
      status: "RUNNING" as const,
      policy: {
        maxIterations: 5,
        maxRuntimeMs: 60000,
        maxDelegations: 5,
        maxActions: 5,
        maxRetries: 3,
        allowedCapabilities: [],
        approvalMode: "AUTO_SAFE" as const,
      },
      iterationsCount: 1,
      delegationsCount: 0,
      actionsCount: 1,
      retriesCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      auditTrail: [],
    };

    store.saveRun(
      runConfig,
      1,
      "worker_1",
      new Date(Date.now() - 1000).toISOString(),
    ); // Expired 1s ago

    // Worker 2 acquires lease on expired run
    const acquired = store.acquireLease("run_lease_1", "worker_2");
    expect(acquired).toBe(true);
    expect(store.isLeaseValid("run_lease_1", "worker_2")).toBe(true);
    expect(store.isLeaseValid("run_lease_1", "worker_1")).toBe(false);

    store.close();
  });

  // 14. Concurrent recovery race
  it("14. concurrent recovery race: atomic lease acquisition prevents duplicate worker recovery", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    // Release initial worker_1 lease so worker_A and worker_B race
    env1.runStore.releaseLease("run_m12_1", "worker_1");

    const store1 = new DurableAutonomyRunStore(dbPath);
    const store2 = new DurableAutonomyRunStore(dbPath);

    const acq1 = store1.acquireLease("run_m12_1", "worker_A");
    const acq2 = store2.acquireLease("run_m12_1", "worker_B");

    expect(acq1).toBe(true);
    expect(acq2).toBe(false); // Worker B rejected!

    store1.close();
    store2.close();
  });

  // 15. Owner revoked during downtime
  it("15. owner revoked during downtime: recovery fails closed to BLOCKED if owner deactivated", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const env2 = setupEnvironment();
    // Deactivate owner during downtime
    (env2.identityStore as any).db.exec(
      "UPDATE user_identities SET status = 'DISABLED' WHERE user_id = 'user_owner_1'",
    );

    const rec = await env2.engine.recoverInterruptedTasks();
    expect(rec.failedRecoveryTasks).toContain("task_m12_1");
    expect(env2.engine.getRun("run_m12_1")?.status).toBe("BLOCKED");
  });

  // 16. Workspace membership revoked during downtime
  it("16. workspace membership revoked during downtime: recovery fails closed to BLOCKED", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const env2 = setupEnvironment();
    // Revoke workspace membership during downtime
    (env2.identityStore as any).db.exec(
      "UPDATE workspace_memberships SET status = 'REVOKED' WHERE workspace_id = 'ws_1' AND user_id = 'user_owner_1'",
    );

    const rec = await env2.engine.recoverInterruptedTasks();
    expect(rec.failedRecoveryTasks).toContain("task_m12_1");
    expect(env2.engine.getRun("run_m12_1")?.status).toBe("BLOCKED");
  });

  // 17. Policy changed during downtime
  it("17. policy changed during downtime: if tool is BLOCKED during downtime, iteration fails closed", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const env2 = setupEnvironment();
    // Change PolicyEngine rule during downtime to BLOCKED
    env2.policyEngine.setRule("git_tool", "BLOCKED");

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
    };

    const res = await env2.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("BLOCKED");
  });

  // 18. Approval invalidated during downtime
  it("18. approval invalidated during downtime: stale approval request is rejected after restart", async () => {
    const env1 = setupEnvironment();
    env1.policyEngine.setRule("git_tool", "APPROVAL_REQUIRED");
    await env1.engine.startRun(env1.defaultConfig);

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: { file: "test.txt" },
    };

    const res1 = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res1.status).toBe("WAITING_FOR_APPROVAL");

    // Restart process (ApprovalManager in-memory tokens are lost)
    const env2 = setupEnvironment();
    const res2 = await env2.engine.approveAndContinueIteration(
      "run_m12_1",
      "user_owner_1",
      "ws_1",
    );
    expect(res2.status).toBe("BLOCKED"); // In-memory approval token missing after restart!
  });

  // 19. Cancellation persisted across restart
  it("19. cancellation persisted across restart: cancelled run stays CANCELLED after restart", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);
    await env1.engine.cancelRun("run_m12_1", "Owner manually cancelled run");

    const env2 = setupEnvironment();
    await env2.engine.recoverInterruptedTasks();

    const recovered = env2.engine.getRun("run_m12_1");
    expect(recovered?.status).toBe("CANCELLED");
    expect(recovered?.terminalReason).toBe("Owner manually cancelled run");
  });

  // 20. Timeout persisted across restart
  it("20. timeout persisted across restart: run exceeding maxRuntimeMs fails closed to TIMED_OUT", async () => {
    const env1 = setupEnvironment();
    const shortConfig = {
      ...env1.defaultConfig,
      policy: { ...env1.defaultConfig.policy, maxRuntimeMs: 10 }, // 10ms timeout
    };
    await env1.engine.startRun(shortConfig);

    // Wait 20ms to ensure timeout
    await new Promise((resolve) => setTimeout(resolve, 20));

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("TIMED_OUT");
  });

  // 21. Terminal state cannot reopen
  it("21. terminal state cannot reopen: completed run rejects new iterations", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
      isTerminalProposal: true,
    };

    const res1 = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res1.status).toBe("COMPLETED");

    // Re-submitting proposal to completed run
    const res2 = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res2.status).toBe("COMPLETED"); // Unchanged!
  });

  // 22. Late result rejected
  it("22. late result rejected: result submitted after run reaches terminal state or lease expires is rejected", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);
    await env1.engine.cancelRun("run_m12_1", "Cancelled early");

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("CANCELLED");
  });

  // 23. Cross-workspace recovery rejected
  it("23. cross-workspace recovery rejected: workspace mismatch during approval or recovery fails closed", async () => {
    const env1 = setupEnvironment();
    env1.policyEngine.setRule("git_tool", "APPROVAL_REQUIRED");
    await env1.engine.startRun(env1.defaultConfig);

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "dev-cap",
      proposedAction: "git_tool",
      params: {},
    };

    await env1.engine.executeIteration("run_m12_1", proposal);

    // Approving under wrong workspace ID
    const res = await env1.engine.approveAndContinueIteration(
      "run_m12_1",
      "user_owner_1",
      "ws_OTHER",
    );
    expect(res.status).toBe("BLOCKED");
    expect(res.terminalReason).toContain("Cross-workspace");
  });

  // 24. Capability escalation rejected
  it("24. capability escalation rejected: proposal with capability outside run policy allowedCapabilities is BLOCKED", async () => {
    const env1 = setupEnvironment();
    await env1.engine.startRun(env1.defaultConfig);

    const proposal: AIProposal = {
      runId: "run_m12_1",
      taskId: "task_m12_1",
      workspaceId: "ws_1",
      requestedCapability: "UNAUTHORIZED_CAPABILITY",
      proposedAction: "git_tool",
      params: {},
    };

    const res = await env1.engine.executeIteration("run_m12_1", proposal);
    expect(res.status).toBe("BLOCKED");
    expect(res.terminalReason).toContain("allowedCapabilities");
  });
});
