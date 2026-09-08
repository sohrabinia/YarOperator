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
