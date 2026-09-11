import { PermissionScope } from "../context/index.js";
export * from "./policy.js";

export interface WorkspaceConfig {
  id: string;
  name: string;
  description: string;
  goals: string[];
  permissions: PermissionScope;
  metadata?: Record<string, unknown>;
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceConfig>();

  registerWorkspace(config: WorkspaceConfig): void {
    if (!config.id || !config.name) {
      throw new Error("Workspace requires valid id and name.");
    }
    if (this.workspaces.has(config.id)) {
      throw new Error(
        `Workspace with ID '${config.id}' is already registered.`,
      );
    }
    this.workspaces.set(config.id, config);
  }

  getWorkspace(id: string): WorkspaceConfig | undefined {
    return this.workspaces.get(id);
  }

  hasWorkspace(id: string): boolean {
    return this.workspaces.has(id);
  }

  listWorkspaces(): WorkspaceConfig[] {
    return Array.from(this.workspaces.values());
  }
}
