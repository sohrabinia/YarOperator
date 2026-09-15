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

export type BrainIntent = "CONVERSATION" | "ACTION";

export interface BrainInput {
  rawCommandText: string;
  ownerId: string;
  workspaceId: string;
  environmentId?: string;
  targetCapability?: string;
  requestedToolId?: string;
  params?: Record<string, unknown>;
  timestamp?: string;
  context?: ExecutionContext;
  metadata?: Record<string, unknown>;
}

export interface BrainResult {
  intent: BrainIntent;
  reply?: string;
  resolvedCapability?: string;
  resolvedToolId?: string;
  params?: Record<string, unknown>;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface BrainRule {
  id: string;
  name: string;
  description?: string;
  evaluate(input: BrainInput): Promise<boolean> | boolean;
}

export interface BrainProvider {
  id: string;
  name: string;
  process(input: BrainInput): Promise<BrainResult>;
}

export interface Brain {
  interpret(input: BrainInput): Promise<BrainResult>;
}
