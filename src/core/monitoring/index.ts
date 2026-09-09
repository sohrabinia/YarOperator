import { PolicyEngine } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import {
  ControlledAutonomyEngine,
  AutonomousActionRequest,
  AutonomyBudget,
} from "../autonomy/index.js";
import { ExecutionContext, ActionSafetyLevel } from "../contracts/index.js";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentStatus =
  | "DETECTED"
  | "TRIAGED"
  | "INVESTIGATING"
  | "MITIGATING"
  | "VERIFYING"
  | "RESOLVED"
  | "ESCALATED";

export interface ProductionObservation {
  id: string;
  workspaceId: string;
  environmentId: string;
  serviceId: string;
  timestamp: string;
  status: HealthStatus;
  httpStatusCode?: number;
  latencyMs?: number;
  errorMessage?: string;
  version?: string;
  metadata?: Record<string, any>;
  sourceToolId: string;
}

export interface IncidentActionRecord {
  id: string;
  toolId: string;
  params: Record<string, any>;
  requestedAt: string;
  executedAt?: string;
  policyDecision: ActionSafetyLevel;
  success?: boolean;
  result?: any;
  error?: string;
}

export interface Incident {
  id: string;
  workspaceId: string;
  environmentId: string;
  serviceId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  detectedAt: string;
  updatedAt: string;
  summary: string;
  initialObservation: ProductionObservation;
  latestObservation?: ProductionObservation;
  actionRecords: IncidentActionRecord[];
  resolutionEvidence?: ProductionObservation;
  escalationReason?: string;
  attemptCount: number;
}

export interface MonitoringConfig {
  maxActionAttempts?: number;
}

export class HealthEvaluator {
  public evaluate(observation: Partial<ProductionObservation>): HealthStatus {
    if (!observation || !observation.status) {
      return "UNKNOWN";
    }

    if (observation.status === "UNKNOWN") {
      return "UNKNOWN";
    }

    if (
      observation.httpStatusCode !== undefined &&
      (observation.httpStatusCode >= 500 || observation.httpStatusCode === 0)
    ) {
      return "UNHEALTHY";
    }

    if (
      observation.errorMessage &&
      observation.errorMessage.trim().length > 0
    ) {
      if (
        observation.httpStatusCode &&
        observation.httpStatusCode >= 400 &&
        observation.httpStatusCode < 500
      ) {
        return "DEGRADED";
      }
      return "UNHEALTHY";
    }

    if (observation.status === "UNHEALTHY") {
      return "UNHEALTHY";
    }

    if (observation.status === "DEGRADED") {
      return "DEGRADED";
    }

    if (observation.status === "HEALTHY") {
      return "HEALTHY";
    }

    return "UNKNOWN";
  }
}

export class IncidentDetector {
  private evaluator: HealthEvaluator;

  constructor(evaluator?: HealthEvaluator) {
    this.evaluator = evaluator || new HealthEvaluator();
  }

  public detect(observation: ProductionObservation): {
    isIncident: boolean;
    severity?: IncidentSeverity;
    summary?: string;
  } {
    const health = this.evaluator.evaluate(observation);

    if (health === "HEALTHY") {
      return { isIncident: false };
    }

    if (health === "UNKNOWN") {
      return {
        isIncident: true,
        severity: "MEDIUM",
        summary: `Unknown health status detected for service ${observation.serviceId} in workspace ${observation.workspaceId}`,
      };
    }

    if (health === "DEGRADED") {
      return {
        isIncident: true,
        severity: "LOW",
        summary: `Degraded health detected for service ${observation.serviceId}: ${
          observation.errorMessage || "latency or HTTP error"
        }`,
      };
    }

    // UNHEALTHY
    let severity: IncidentSeverity = "HIGH";
    if (
      observation.errorMessage?.toLowerCase().includes("critical") ||
      observation.errorMessage
        ?.toLowerCase()
        .includes("database connection failed") ||
      observation.httpStatusCode === 503
    ) {
      severity = "CRITICAL";
    }

    return {
      isIncident: true,
      severity,
      summary: `Unhealthy service ${observation.serviceId} in environment ${
        observation.environmentId
      }: ${observation.errorMessage || `HTTP ${observation.httpStatusCode}`}`,
    };
  }
}

export class IncidentManager {
  private incidents: Map<string, Incident> = new Map();
  private auditManager?: AuditManager;
  private notificationManager?: NotificationManager;

  constructor(
    auditManager?: AuditManager,
    notificationManager?: NotificationManager,
  ) {
    this.auditManager = auditManager;
    this.notificationManager = notificationManager;
  }

  public createIncident(
    observation: ProductionObservation,
    severity: IncidentSeverity,
    summary: string,
  ): Incident {
    const id = `inc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const incident: Incident = {
      id,
      workspaceId: observation.workspaceId,
      environmentId: observation.environmentId,
      serviceId: observation.serviceId,
      status: "DETECTED",
      severity,
      detectedAt: now,
      updatedAt: now,
      summary,
      initialObservation: observation,
      latestObservation: observation,
      actionRecords: [],
      attemptCount: 0,
    };

    this.incidents.set(id, incident);

    if (this.auditManager) {
      this.auditManager.recordEvent(
        "ACTION_STARTED",
        {
          event: "INCIDENT_CREATED",
          incidentId: incident.id,
          severity,
          summary,
        },
        { workspaceId: incident.workspaceId, taskId: incident.id },
      );
    }

    if (
      this.notificationManager &&
      (severity === "HIGH" || severity === "CRITICAL")
    ) {
      this.notificationManager.notify({
        workspaceId: incident.workspaceId,
        taskId: incident.id,
        type: "TASK_FAILED",
        priority: severity === "CRITICAL" ? "URGENT" : "HIGH",
        title: `[${severity}] Incident Created: ${incident.serviceId}`,
        message: summary,
      });
    }

    return incident;
  }

  public getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  public listIncidents(workspaceId?: string): Incident[] {
    const list = Array.from(this.incidents.values());
    if (workspaceId) {
      return list.filter((i) => i.workspaceId === workspaceId);
    }
    return list;
  }

  public transitionState(
    incidentId: string,
    nextStatus: IncidentStatus,
    reason?: string,
  ): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const validTransitions: Record<IncidentStatus, IncidentStatus[]> = {
      DETECTED: ["TRIAGED", "ESCALATED"],
      TRIAGED: ["INVESTIGATING", "ESCALATED"],
      INVESTIGATING: ["MITIGATING", "ESCALATED"],
      MITIGATING: ["VERIFYING", "ESCALATED"],
      VERIFYING: ["RESOLVED", "INVESTIGATING", "ESCALATED"],
      RESOLVED: [],
      ESCALATED: ["TRIAGED", "INVESTIGATING", "RESOLVED"],
    };

    const allowed = validTransitions[incident.status];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new Error(
        `Invalid incident state transition from ${incident.status} to ${nextStatus}`,
      );
    }

    incident.status = nextStatus;
    incident.updatedAt = new Date().toISOString();
    if (nextStatus === "ESCALATED" && reason) {
      incident.escalationReason = reason;
    }

    if (this.auditManager) {
      this.auditManager.recordEvent(
        "ACTION_COMPLETED",
        {
          event: "INCIDENT_STATE_TRANSITION",
          incidentId: incident.id,
          nextStatus,
          reason,
        },
        { workspaceId: incident.workspaceId, taskId: incident.id },
      );
    }

    if (
      this.notificationManager &&
      (nextStatus === "ESCALATED" || nextStatus === "RESOLVED")
    ) {
      this.notificationManager.notify({
        workspaceId: incident.workspaceId,
        taskId: incident.id,
        type: nextStatus === "RESOLVED" ? "TASK_COMPLETED" : "ESCALATION",
        priority: nextStatus === "RESOLVED" ? "MEDIUM" : "HIGH",
        title: `Incident ${incident.id} is now ${nextStatus}`,
        message: reason || `Incident transitioned to ${nextStatus}`,
      });
    }

    return incident;
  }

  public recordAction(
    incidentId: string,
    actionRecord: IncidentActionRecord,
  ): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    incident.actionRecords.push(actionRecord);
    incident.attemptCount += 1;
    incident.updatedAt = new Date().toISOString();
    return incident;
  }

  public resolveIncident(
    incidentId: string,
    verificationObservation: ProductionObservation,
  ): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const evaluator = new HealthEvaluator();
    const freshHealth = evaluator.evaluate(verificationObservation);

    if (freshHealth !== "HEALTHY") {
      throw new Error(
        `Cannot resolve incident ${incidentId}: Verification observation is not HEALTHY (status: ${freshHealth})`,
      );
    }

    incident.resolutionEvidence = verificationObservation;
    incident.latestObservation = verificationObservation;
    return this.transitionState(
      incidentId,
      "RESOLVED",
      "Resolved with fresh healthy evidence",
    );
  }
}

export class IncidentResponseLoop {
  private detector: IncidentDetector;
  private manager: IncidentManager;
  private policyEngine: PolicyEngine;
  private autonomyEngine: ControlledAutonomyEngine;
  private maxAttempts: number;

  constructor(params: {
    detector?: IncidentDetector;
    manager: IncidentManager;
    policyEngine: PolicyEngine;
    autonomyEngine: ControlledAutonomyEngine;
    config?: MonitoringConfig;
  }) {
    this.detector = params.detector || new IncidentDetector();
    this.manager = params.manager;
    this.policyEngine = params.policyEngine;
    this.autonomyEngine = params.autonomyEngine;
    this.maxAttempts = params.config?.maxActionAttempts ?? 3;
  }

  public async handleObservation(
    observation: ProductionObservation,
    context: ExecutionContext,
    recoveryAction?: {
      toolId: string;
      params: Record<string, any>;
      fetchFreshObservation: () => Promise<ProductionObservation>;
    },
  ): Promise<{
    incident?: Incident;
    actionExecuted: boolean;
    resolved: boolean;
  }> {
    const detection = this.detector.detect(observation);
    if (!detection.isIncident) {
      return { actionExecuted: false, resolved: false };
    }

    const incident = this.manager.createIncident(
      observation,
      detection.severity || "MEDIUM",
      detection.summary || "Production incident detected",
    );

    this.manager.transitionState(incident.id, "TRIAGED");
    this.manager.transitionState(incident.id, "INVESTIGATING");

    if (!recoveryAction) {
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        "No automated recovery action provided for incident",
      );
      return { incident, actionExecuted: false, resolved: false };
    }

    if (incident.attemptCount >= this.maxAttempts) {
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        `Exceeded maximum recovery attempt count (${this.maxAttempts})`,
      );
      return { incident, actionExecuted: false, resolved: false };
    }

    this.manager.transitionState(incident.id, "MITIGATING");

    const policyRule =
      this.policyEngine.getRule(recoveryAction.toolId) || "BLOCKED";

    const actionRecord: IncidentActionRecord = {
      id: `act_${Date.now()}`,
      toolId: recoveryAction.toolId,
      params: recoveryAction.params,
      requestedAt: new Date().toISOString(),
      policyDecision: policyRule,
    };

    if (policyRule === "BLOCKED" || policyRule === "APPROVAL_REQUIRED") {
      actionRecord.success = false;
      actionRecord.error = `Policy decision ${policyRule} prevented automatic recovery execution`;
      this.manager.recordAction(incident.id, actionRecord);
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        `Recovery action tool ${recoveryAction.toolId} requires ${policyRule}`,
      );
      return { incident, actionExecuted: false, resolved: false };
    }

    // Policy decision is SAFE
    const request: AutonomousActionRequest = {
      taskId: incident.id,
      workspaceId: observation.workspaceId,
      toolId: recoveryAction.toolId,
      params: recoveryAction.params,
    };

    const budget: AutonomyBudget = {
      maxActions: 5,
      maxRetries: 1,
      maxReplans: 1,
      usedActions: 0,
      usedRetries: 0,
      usedReplans: 0,
    };

    const runResult = await this.autonomyEngine.runControlledAction(
      request,
      budget,
      context,
    );

    actionRecord.executedAt = new Date().toISOString();
    actionRecord.success = runResult.success;
    actionRecord.result = runResult.evidence?.toolResult;
    actionRecord.error = runResult.error;
    this.manager.recordAction(incident.id, actionRecord);

    if (!runResult.success) {
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        `Recovery action tool execution failed: ${runResult.error}`,
      );
      return { incident, actionExecuted: true, resolved: false };
    }

    // Verify with fresh observation
    this.manager.transitionState(incident.id, "VERIFYING");
    const freshObs = await recoveryAction.fetchFreshObservation();

    // Verify workspace and environment scope matches
    if (
      freshObs.workspaceId !== observation.workspaceId ||
      freshObs.environmentId !== observation.environmentId
    ) {
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        "Fresh verification observation workspace or environment mismatch",
      );
      return { incident, actionExecuted: true, resolved: false };
    }

    try {
      this.manager.resolveIncident(incident.id, freshObs);
      return { incident, actionExecuted: true, resolved: true };
    } catch (err: any) {
      this.manager.transitionState(
        incident.id,
        "ESCALATED",
        `Fresh verification failed: ${err?.message || err}`,
      );
      return { incident, actionExecuted: true, resolved: false };
    }
  }
}
