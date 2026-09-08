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
}
