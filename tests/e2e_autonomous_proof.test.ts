import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentRegistry,
  AgentOrchestrator,
  NotificationManager,
  EnvironmentManager,
  SecureToolEcosystem,
  PreviewManager,
  BaselineManager,
  RegressionEngine,
  AcceptanceEngine,
  AutonomousDevelopmentLoop,
} from "../src/index.js";

describe("Phase 16-26 End-to-End Autonomous Development Loop Proof", () => {
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let notificationManager: NotificationManager;
  let environmentManager: EnvironmentManager;
  let toolEcosystem: SecureToolEcosystem;
  let previewManager: PreviewManager;
  let baselineManager: BaselineManager;
  let regressionEngine: RegressionEngine;
  let acceptanceEngine: AcceptanceEngine;
  let autonomousLoop: AutonomousDevelopmentLoop;

  beforeEach(() => {
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);
    notificationManager = new NotificationManager();
    environmentManager = new EnvironmentManager();
    toolEcosystem = new SecureToolEcosystem();
    previewManager = new PreviewManager();
    baselineManager = new BaselineManager();
    regressionEngine = new RegressionEngine();
    acceptanceEngine = new AcceptanceEngine();
    autonomousLoop = new AutonomousDevelopmentLoop(
      orchestrator,
      notificationManager,
    );

    agentRegistry.registerAgent({
      id: "jules_agent",
      name: "Jules Dev Agent",
      capabilities: ["software-development"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["git_operate", "terminal_execute"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    environmentManager.registerEnvironment({
      id: "env_test",
      name: "Test Env",
      type: "TEST",
      capabilities: ["build", "test"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
    });
  });

  it("should execute complete autonomous loop proof from goal to acceptance and notification", async () => {
    // 1. Select Agent and create Execution Scope
    const agent = orchestrator.selectAgentForCapability(
      "software-development",
      "yartrader",
    );
    expect(agent).toBeDefined();

    const scope = orchestrator.createExecutionScope({
      workspaceId: "yartrader",
      agentId: agent!.id,
      capabilities: ["software-development"],
      tools: ["git_operate", "terminal_execute"],
    });

    // 2. Verify tool authorization
    expect(toolEcosystem.isToolAuthorized("git_operate", scope)).toBe(true);
    expect(toolEcosystem.isToolAuthorized("blocked_tool", scope)).toBe(false);

    // 3. Create Preview and Baseline
    const preview = previewManager.createPreview("feature/proof", "env_test");
    expect(preview.status).toBe("READY");

    baselineManager.saveBaseline({
      id: "base_1",
      version: "1.0",
      routes: ["/"],
      domTreeHash: "hash_a",
      screenshotHash: "hash_b",
      createdAt: new Date(),
    });

    const baseline = baselineManager.getBaseline("base_1");
    expect(baseline).toBeDefined();

    // 4. Regression & Acceptance Evaluation
    const regression = regressionEngine.compare(baseline!, {
      id: "snap_2",
      version: "1.1",
      routes: ["/"],
      domTreeHash: "hash_a",
      screenshotHash: "hash_b",
      createdAt: new Date(),
    });
    expect(regression.hasRegression).toBe(false);

    const acceptance = acceptanceEngine.evaluate({ requiredRoutes: ["/"] }, [
      "/",
    ]);
    expect(acceptance.passed).toBe(true);

    // 5. Autonomous Loop Run & Notification
    const loopResult = await autonomousLoop.runLoop(
      "task_e2e",
      "software-development",
      "yartrader",
    );
    expect(loopResult.status).toBe("SUCCESS");

    const notifications = notificationManager.listNotifications({
      workspaceId: "yartrader",
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("TASK_COMPLETED");
  });
});
