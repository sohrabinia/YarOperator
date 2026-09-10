export type EnvironmentType =
  | "LOCAL"
  | "DEVELOPMENT"
  | "TEST"
  | "STAGING"
  | "PRODUCTION"
  | "IRAN_SERVER"
  | "GERMANY_SERVER";

export interface EnvironmentConfig {
  id: string;
  name: string;
  type: EnvironmentType;
  capabilities: string[];
  url?: string;
  accessScope: string;
  riskLevel: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  healthy: boolean;
  metadata?: Record<string, unknown>;
}

export class EnvironmentManager {
  private environments = new Map<string, EnvironmentConfig>();

  registerEnvironment(config: EnvironmentConfig): void {
    if (!config.id || !config.name) {
      throw new Error("Environment requires valid id and name.");
    }
    this.environments.set(config.id, config);
  }

  getEnvironment(id: string): EnvironmentConfig | undefined {
    return this.environments.get(id);
  }

  listEnvironments(type?: EnvironmentType): EnvironmentConfig[] {
    const all = Array.from(this.environments.values());
    if (!type) return all;
    return all.filter((e) => e.type === type);
  }

  validateEnvironmentAccess(
    environmentId: string,
    workspaceId: string,
    toolId?: string,
  ): { valid: boolean; reason?: string; environment?: EnvironmentConfig } {
    const env = this.getEnvironment(environmentId);
    if (!env) {
      return {
        valid: false,
        reason: `Environment '${environmentId}' does not exist or is not registered.`,
      };
    }

    if (env.healthy === false) {
      return {
        valid: false,
        reason: `Environment '${environmentId}' is currently unhealthy or in an unexecutable state.`,
        environment: env,
      };
    }

    if (env.riskLevel === "BLOCKED") {
      return {
        valid: false,
        reason: `Environment '${environmentId}' is explicitly BLOCKED by environment policy.`,
        environment: env,
      };
    }

    const boundWorkspace = env.metadata?.workspaceId as string | undefined;
    const allowedWorkspaces =
      (env.metadata?.allowedWorkspaces as string[]) || [];

    if (
      boundWorkspace &&
      boundWorkspace !== workspaceId &&
      !allowedWorkspaces.includes(workspaceId)
    ) {
      return {
        valid: false,
        reason: `Environment '${environmentId}' belongs to workspace '${boundWorkspace}' and is not authorized for workspace '${workspaceId}'.`,
        environment: env,
      };
    }

    if (toolId && env.capabilities && env.capabilities.length > 0) {
      const toolAllowed = env.capabilities.some(
        (cap) => cap === "*" || cap === toolId || toolId.includes(cap),
      );
      if (!toolAllowed) {
        return {
          valid: false,
          reason: `Tool '${toolId}' is not authorized in environment '${environmentId}'.`,
          environment: env,
        };
      }
    }

    return { valid: true, environment: env };
  }
}
