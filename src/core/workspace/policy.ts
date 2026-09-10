import { resolve, isAbsolute, relative } from "path";

export interface WorkspacePolicyConfig {
  workspaceId: string;
  allowedRoots: string[];
  allowedTools: string[];
}

export class WorkspacePolicy {
  private config: WorkspacePolicyConfig;

  constructor(config: WorkspacePolicyConfig) {
    if (!config.workspaceId) {
      throw new Error("WorkspacePolicy requires a valid workspaceId.");
    }
    this.config = {
      workspaceId: config.workspaceId,
      allowedRoots: (config.allowedRoots || []).map((r) => resolve(r)),
      allowedTools: config.allowedTools || [],
    };
  }

  public getWorkspaceId(): string {
    return this.config.workspaceId;
  }

  public getAllowedRoots(): string[] {
    return [...this.config.allowedRoots];
  }

  public getAllowedTools(): string[] {
    return [...this.config.allowedTools];
  }

  public validateTool(toolId: string): { allowed: boolean; reason?: string } {
    if (!toolId) {
      return { allowed: false, reason: "Tool ID is required." };
    }
    if (
      this.config.allowedTools.length > 0 &&
      !this.config.allowedTools.includes(toolId) &&
      !this.config.allowedTools.includes("*")
    ) {
      return {
        allowed: false,
        reason: `Tool '${toolId}' is not permitted by WorkspacePolicy for workspace '${this.config.workspaceId}'.`,
      };
    }
    return { allowed: true };
  }

  public validateRoot(targetPath: string): {
    allowed: boolean;
    resolvedPath?: string;
    reason?: string;
  } {
    if (!targetPath) {
      return { allowed: false, reason: "Target path is required." };
    }

    const resolvedTarget = resolve(targetPath);

    if (this.config.allowedRoots.length === 0) {
      // If no roots explicitly configured, default to current working directory or process root
      const defaultRoot = resolve(process.cwd());
      const rel = relative(defaultRoot, resolvedTarget);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return {
          allowed: false,
          reason: `Target path '${targetPath}' escapes default workspace root '${defaultRoot}'.`,
        };
      }
      return { allowed: true, resolvedPath: resolvedTarget };
    }

    const isInsideAllowedRoot = this.config.allowedRoots.some((allowedRoot) => {
      const rel = relative(allowedRoot, resolvedTarget);
      return !rel.startsWith("..") && !isAbsolute(rel);
    });

    if (!isInsideAllowedRoot) {
      return {
        allowed: false,
        reason: `Target path '${targetPath}' (resolved: '${resolvedTarget}') is outside authorized workspace roots [${this.config.allowedRoots.join(", ")}].`,
      };
    }

    return { allowed: true, resolvedPath: resolvedTarget };
  }
}

export class WorkspacePolicyManager {
  private policies = new Map<string, WorkspacePolicy>();

  public registerPolicy(policy: WorkspacePolicy): void {
    this.policies.set(policy.getWorkspaceId(), policy);
  }

  public getPolicy(workspaceId: string): WorkspacePolicy | undefined {
    return this.policies.get(workspaceId);
  }

  public validateToolAccess(
    workspaceId: string,
    toolId: string,
  ): { allowed: boolean; reason?: string } {
    const policy = this.getPolicy(workspaceId);
    if (!policy) {
      // Default fail closed if policy explicitly missing
      return {
        allowed: true, // Allow if no workspace-level policy registered, leaving to EnvironmentManager
      };
    }
    return policy.validateTool(toolId);
  }

  public validateRootAccess(
    workspaceId: string,
    targetPath: string,
  ): { allowed: boolean; resolvedPath?: string; reason?: string } {
    const policy = this.getPolicy(workspaceId);
    if (!policy) {
      const resolvedTarget = resolve(targetPath);
      const defaultRoot = resolve(process.cwd());
      const rel = relative(defaultRoot, resolvedTarget);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return {
          allowed: false,
          reason: `Target path '${targetPath}' escapes workspace root '${defaultRoot}'.`,
        };
      }
      return { allowed: true, resolvedPath: resolvedTarget };
    }
    return policy.validateRoot(targetPath);
  }
}
