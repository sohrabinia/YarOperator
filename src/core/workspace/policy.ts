import { resolve, isAbsolute, relative } from "path";

export interface WorkspacePolicyConfig {
  workspaceId: string;
  allowedRoots: string[];
  allowedTools: string[];
}

export class WorkspacePolicy {
  private config: WorkspacePolicyConfig;

  constructor(config: WorkspacePolicyConfig) {
    if (!config.workspaceId || config.workspaceId.trim().length === 0) {
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
    if (!toolId || toolId.trim().length === 0) {
      return { allowed: false, reason: "Tool ID is required." };
    }
    if (
      !this.config.allowedTools ||
      !this.config.allowedTools.includes(toolId)
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
    if (
      !targetPath ||
      typeof targetPath !== "string" ||
      targetPath.trim().length === 0
    ) {
      return { allowed: false, reason: "Target path is required." };
    }

    if (!this.config.allowedRoots || this.config.allowedRoots.length === 0) {
      return {
        allowed: false,
        reason: `No allowed roots configured in WorkspacePolicy for workspace '${this.config.workspaceId}' (fail-closed root boundary).`,
      };
    }

    const resolvedTarget = resolve(targetPath);

    const isInsideAllowedRoot = this.config.allowedRoots.some((allowedRoot) => {
      const rel = relative(allowedRoot, resolvedTarget);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
    if (!policy || !policy.getWorkspaceId()) {
      throw new Error("WorkspacePolicy must have a valid workspaceId.");
    }
    this.policies.set(policy.getWorkspaceId(), policy);
  }

  public getPolicy(workspaceId: string): WorkspacePolicy | undefined {
    return this.policies.get(workspaceId);
  }

  public validateToolAccess(
    workspaceId: string,
    toolId: string,
  ): { allowed: boolean; reason?: string } {
    if (!workspaceId || workspaceId.trim().length === 0) {
      return {
        allowed: false,
        reason: "Missing workspaceId for WorkspacePolicy validation.",
      };
    }

    const policy = this.getPolicy(workspaceId);
    if (!policy) {
      return {
        allowed: false,
        reason: `No WorkspacePolicy registered for workspace '${workspaceId}'.`,
      };
    }
    return policy.validateTool(toolId);
  }

  public validateRootAccess(
    workspaceId: string,
    targetPath: string,
  ): { allowed: boolean; resolvedPath?: string; reason?: string } {
    if (!workspaceId || workspaceId.trim().length === 0) {
      return {
        allowed: false,
        reason: "Missing workspaceId for WorkspacePolicy validation.",
      };
    }

    const policy = this.getPolicy(workspaceId);
    if (!policy) {
      return {
        allowed: false,
        reason: `No WorkspacePolicy registered for workspace '${workspaceId}'.`,
      };
    }
    return policy.validateRoot(targetPath);
  }
}
