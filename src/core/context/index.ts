export type OperatingMode =
  "development" | "production" | "personal" | "restricted";

export interface UserContext {
  id: string;
  name: string;
  role: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  name: string;
}

export interface PermissionScope {
  allowedActions: string[];
  restrictedActions: string[];
}

export interface ConstraintSet {
  maxRiskLevel?: "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";
  requireApprovalForExternalCalls?: boolean;
}

export interface RuntimeContext {
  id: string;
  user: UserContext;
  workspace: WorkspaceContext;
  goal: string;
  task?: string;
  mode: OperatingMode;
  permissions: PermissionScope;
  constraints: ConstraintSet;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: Date;
}
