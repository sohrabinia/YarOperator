import { describe, it, expect, beforeEach } from "vitest";
import {
  HealthEvaluator,
  IncidentDetector,
  IncidentManager,
  IncidentResponseLoop,
  ProductionObservation,
} from "../src/core/monitoring/index.js";
import { PolicyEngine, ApprovalManager } from "../src/core/policy/index.js";
import { AuditManager } from "../src/core/audit/index.js";
import { NotificationManager } from "../src/core/notification/index.js";
import { ControlledAutonomyEngine } from "../src/core/autonomy/index.js";
import {
  SecureToolEcosystem,
  Tool,
  ToolResult,
} from "../src/core/tools/index.js";
import { OwnerManager } from "../src/core/owner/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";
import { AgentOrchestrator } from "../src/core/orchestrator/index.js";
import { EnvironmentManager } from "../src/core/environment/index.js";
import { ExecutionContext } from "../src/core/contracts/index.js";

class MockRestartTool implements Tool {
  metadata = {
    id: "mock_restart_tool",
    name: "Mock Restart Tool",
    description: "Restarts service",
    safetyLevel: "SAFE" as const,
  };
  invocations: any[] = [];

  async execute(
    params: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push({ params, context });
    return {
      success: true,
      output: { restarted: true, serviceId: (params as any)?.serviceId },
    };
  }
}

describe("Phase 28 — Production Monitoring & Incident Loop", () => {
  let evaluator: HealthEvaluator;
  let detector: IncidentDetector;
  let auditManager: AuditManager;
  let notificationManager: NotificationManager;
  let incidentManager: IncidentManager;
  let policyEngine: PolicyEngine;
  let toolEcosystem: SecureToolEcosystem;
  let approvalManager: ApprovalManager;
  let ownerManager: OwnerManager;
  let agentRegistry: AgentRegistry;
  let orchestrator: AgentOrchestrator;
  let autonomyEngine: ControlledAutonomyEngine;
  let restartTool: MockRestartTool;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    evaluator = new HealthEvaluator();
    detector = new IncidentDetector(evaluator);
    auditManager = new AuditManager();
    notificationManager = new NotificationManager();
    incidentManager = new IncidentManager(auditManager, notificationManager);

    approvalManager = new ApprovalManager();
    policyEngine = new PolicyEngine(approvalManager);
    toolEcosystem = new SecureToolEcosystem();
    ownerManager = new OwnerManager();
    agentRegistry = new AgentRegistry();
    orchestrator = new AgentOrchestrator(agentRegistry);

    restartTool = new MockRestartTool();
    toolEcosystem.registerTool(restartTool);

    const environmentManager = new EnvironmentManager();
    environmentManager.registerEnvironment({
      id: "prod",
      name: "Production Environment",
      type: "PRODUCTION",
      capabilities: ["mock_restart_tool"],
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: "yartrader" },
    });

    autonomyEngine = new ControlledAutonomyEngine(
      orchestrator,
      policyEngine,
      approvalManager,
      toolEcosystem,
      undefined, // AcceptanceEngine
      auditManager,
      notificationManager,
      undefined,
      environmentManager,
    );

    agentRegistry.registerAgent({
      id: "jules_autonomy_agent",
      name: "Monitoring Agent",
      capabilities: ["software-development", "monitoring"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["mock_restart_tool"],
      provider: "JulesProvider",
      model: "jules-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    mockContext = {
      executionId: "exec_mon_1",
      timestamp: new Date(),
    };
  });

  describe("A. Health Evaluator & Observation Classification", () => {
    it("1. Healthy observation evaluates to HEALTHY", () => {
      const obs: Partial<ProductionObservation> = {
        status: "HEALTHY",
        httpStatusCode: 200,
      };
      expect(evaluator.evaluate(obs)).toBe("HEALTHY");
    });

    it("2. HTTP 500 or 0 evaluates to UNHEALTHY", () => {
      expect(
        evaluator.evaluate({ status: "HEALTHY", httpStatusCode: 500 }),
      ).toBe("UNHEALTHY");
      expect(evaluator.evaluate({ status: "HEALTHY", httpStatusCode: 0 })).toBe(
        "UNHEALTHY",
      );
    });

    it("3. HTTP 400 with error evaluates to DEGRADED", () => {
      expect(
        evaluator.evaluate({
          status: "DEGRADED",
          httpStatusCode: 404,
          errorMessage: "Not found",
        }),
      ).toBe("DEGRADED");
    });

    it("4. Unknown/missing status evaluates to UNKNOWN", () => {
      expect(evaluator.evaluate({})).toBe("UNKNOWN");
      expect(evaluator.evaluate({ status: "UNKNOWN" })).toBe("UNKNOWN");
    });
  });

  describe("B. Incident Detection & Severity Classification", () => {
    it("5. Healthy observation does not create incident", () => {
      const obs: ProductionObservation = {
        id: "obs_1",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "trading_core",
        timestamp: new Date().toISOString(),
        status: "HEALTHY",
        httpStatusCode: 200,
        sourceToolId: "health_checker",
      };
      const res = detector.detect(obs);
      expect(res.isIncident).toBe(false);
    });

    it("6. Critical error message classifies incident severity as CRITICAL", () => {
      const obs: ProductionObservation = {
        id: "obs_2",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "trading_core",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 500,
        errorMessage: "Critical database connection failed",
        sourceToolId: "health_checker",
      };
      const res = detector.detect(obs);
      expect(res.isIncident).toBe(true);
      expect(res.severity).toBe("CRITICAL");
    });
  });

  describe("C. Incident Manager Lifecycle & State Transitions", () => {
    it("7. Valid state transitions update incident status and record audit", async () => {
      const obs: ProductionObservation = {
        id: "obs_3",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "trading_core",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 500,
        sourceToolId: "health_checker",
      };
      const inc = incidentManager.createIncident(
        obs,
        "HIGH",
        "High severity failure",
      );

      expect(inc.status).toBe("DETECTED");

      incidentManager.transitionState(inc.id, "TRIAGED");
      expect(inc.status).toBe("TRIAGED");

      incidentManager.transitionState(inc.id, "INVESTIGATING");
      expect(inc.status).toBe("INVESTIGATING");

      const auditEvents = await auditManager.queryEvents({
        workspaceId: "yartrader",
        taskId: inc.id,
      });
      expect(auditEvents.length).toBeGreaterThan(0);
    });

    it("8. Invalid state transition throws error and fails closed", () => {
      const obs: ProductionObservation = {
        id: "obs_4",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "trading_core",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 500,
        sourceToolId: "health_checker",
      };
      const inc = incidentManager.createIncident(
        obs,
        "HIGH",
        "High severity failure",
      );

      // Cannot transition directly from DETECTED to RESOLVED
      expect(() => incidentManager.transitionState(inc.id, "RESOLVED")).toThrow(
        "Invalid incident state transition",
      );
    });
  });

  describe("D. Incident Response Loop & Recovery Verification", () => {
    it("9. Successful action followed by HEALTHY fresh observation resolves incident", async () => {
      policyEngine.setRule("mock_restart_tool", "SAFE");
      const loop = new IncidentResponseLoop({
        detector,
        manager: incidentManager,
        policyEngine,
        autonomyEngine,
      });

      const unhealthyObs: ProductionObservation = {
        id: "obs_unhealthy",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 503,
        errorMessage: "Service unavailable",
        sourceToolId: "health_checker",
      };

      const healthyObs: ProductionObservation = {
        id: "obs_healthy_fresh",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "HEALTHY",
        httpStatusCode: 200,
        sourceToolId: "health_checker",
      };

      const result = await loop.handleObservation(unhealthyObs, mockContext, {
        toolId: "mock_restart_tool",
        params: { serviceId: "api_gateway" },
        fetchFreshObservation: async () => healthyObs,
      });

      expect(result.actionExecuted).toBe(true);
      expect(result.resolved).toBe(true);
      expect(result.incident?.status).toBe("RESOLVED");
      expect(restartTool.invocations.length).toBe(1);
    });

    it("10. Successful action followed by UNHEALTHY fresh observation ESCALATES incident", async () => {
      policyEngine.setRule("mock_restart_tool", "SAFE");
      const loop = new IncidentResponseLoop({
        detector,
        manager: incidentManager,
        policyEngine,
        autonomyEngine,
      });

      const unhealthyObs: ProductionObservation = {
        id: "obs_unhealthy_1",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 503,
        errorMessage: "Service unavailable",
        sourceToolId: "health_checker",
      };

      const stillUnhealthyObs: ProductionObservation = {
        id: "obs_unhealthy_fresh",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 503,
        errorMessage: "Service still unavailable after restart",
        sourceToolId: "health_checker",
      };

      const result = await loop.handleObservation(unhealthyObs, mockContext, {
        toolId: "mock_restart_tool",
        params: { serviceId: "api_gateway" },
        fetchFreshObservation: async () => stillUnhealthyObs,
      });

      expect(result.actionExecuted).toBe(true);
      expect(result.resolved).toBe(false);
      expect(result.incident?.status).toBe("ESCALATED");
    });

    it("11. Action requiring APPROVAL_REQUIRED does NOT execute and ESCALATES incident", async () => {
      policyEngine.setRule("mock_restart_tool", "APPROVAL_REQUIRED");
      const loop = new IncidentResponseLoop({
        detector,
        manager: incidentManager,
        policyEngine,
        autonomyEngine,
      });

      const unhealthyObs: ProductionObservation = {
        id: "obs_unhealthy_app",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 500,
        sourceToolId: "health_checker",
      };

      const result = await loop.handleObservation(unhealthyObs, mockContext, {
        toolId: "mock_restart_tool",
        params: { serviceId: "api_gateway" },
        fetchFreshObservation: async () => unhealthyObs,
      });

      expect(result.actionExecuted).toBe(false);
      expect(result.resolved).toBe(false);
      expect(result.incident?.status).toBe("ESCALATED");
      expect(restartTool.invocations.length).toBe(0); // Tool NEVER invoked
    });

    it("12. Workspace mismatch on fresh verification ESCALATES incident", async () => {
      policyEngine.setRule("mock_restart_tool", "SAFE");
      const loop = new IncidentResponseLoop({
        detector,
        manager: incidentManager,
        policyEngine,
        autonomyEngine,
      });

      const unhealthyObs: ProductionObservation = {
        id: "obs_unhealthy_ws",
        workspaceId: "yartrader",
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "UNHEALTHY",
        httpStatusCode: 503,
        sourceToolId: "health_checker",
      };

      const mismatchedWsObs: ProductionObservation = {
        id: "obs_mismatched_ws",
        workspaceId: "other_workspace", // Mismatched workspace
        environmentId: "prod",
        serviceId: "api_gateway",
        timestamp: new Date().toISOString(),
        status: "HEALTHY",
        httpStatusCode: 200,
        sourceToolId: "health_checker",
      };

      const result = await loop.handleObservation(unhealthyObs, mockContext, {
        toolId: "mock_restart_tool",
        params: { serviceId: "api_gateway" },
        fetchFreshObservation: async () => mismatchedWsObs,
      });

      expect(result.actionExecuted).toBe(true);
      expect(result.resolved).toBe(false);
      expect(result.incident?.status).toBe("ESCALATED");
      expect(result.incident?.escalationReason).toContain(
        "workspace or environment mismatch",
      );
    });
  });
});
