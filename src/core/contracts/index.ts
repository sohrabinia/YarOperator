export type ActionSafetyLevel = "SAFE" | "APPROVAL_REQUIRED" | "BLOCKED";

export interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  safetyLevel: ActionSafetyLevel;
}

export interface ExecutionContext {
  executionId: string;
  timestamp: Date;
  ownerId?: string;
  workspaceId?: string;
  environmentId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolRequest<TParams = unknown> {
  toolId: string;
  params: TParams;
  context: ExecutionContext;
}

export interface ToolResult<TOutput = unknown> {
  success: boolean;
  output?: TOutput;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Tool<TParams = unknown, TOutput = unknown> {
  metadata: ToolMetadata;
  resolveCanonicalAction?(params: TParams): string;
  execute(
    params: TParams,
    context: ExecutionContext,
  ): Promise<ToolResult<TOutput>>;
}

export type ExecutionState =
  "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface AuditEvent {
  id: string;
  executionId: string;
  timestamp: Date;
  type:
    | "STEP_START"
    | "STEP_END"
    | "POLICY_EVALUATION"
    | "APPROVAL_REQUEST"
    | "STATE_TRANSITION"
    | "ERROR";
  details: Record<string, unknown>;
}

export type BrainIntent = "CONVERSATION" | "ACTION" | "AMBIGUOUS";

export type ActionGoalCategory =
  "INVESTIGATION" | "DEVELOPMENT" | "VERIFICATION" | "RESEARCH";

export interface BrainInput {
  rawCommandText: string;
  ownerId?: string;
  workspaceId?: string;
  environmentId?: string;
  metadata?: Record<string, unknown>;
}

export interface BrainPlanStep {
  id: string;
  purpose: string;
  action: ActionGoalCategory;
  toolId?: string;
  params?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface BrainPlan {
  goal: string;
  steps: BrainPlanStep[];
  metadata?: Record<string, unknown>;
}

export interface BrainPlanValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BrainResult {
  intent: BrainIntent;
  reply?: string;
  confidence?: number;
  reason?: string;
  actionGoal?: ActionGoalCategory;
  plan?: BrainPlan;
  metadata?: Record<string, unknown>;
}

export interface BrainRule {
  id: string;
  description: string;
  matches(input: BrainInput): boolean;
  evaluate(input: BrainInput): BrainResult;
}

export interface BrainProvider {
  id: string;
  name: string;
  interpret(input: BrainInput): Promise<BrainResult> | BrainResult;
}

export interface Brain {
  interpret(input: BrainInput): Promise<BrainResult> | BrainResult;
}

export type StepExecutionState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "SKIPPED";

export interface StepExecutionResult {
  stepId: string;
  purpose: string;
  action: ActionGoalCategory;
  state: StepExecutionState;
  resolvedCapability?: string;
  resolvedToolId?: string;
  output?: unknown;
  error?: string;
  reason?: string;
  skippedDueToDependency?: string;
}

export interface PlanExecutionResult {
  goal: string;
  success: boolean;
  status: "COMPLETED" | "FAILED" | "BLOCKED" | "APPROVAL_REQUIRED" | "PARTIAL";
  executionOrder: string[];
  stepResults: Record<string, StepExecutionResult>;
  stoppedEarly: boolean;
  stopReason?: string;
}
