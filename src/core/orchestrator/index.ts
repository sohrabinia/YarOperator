import { AgentRegistry, RegisteredAgent } from "../agent/index.js";

export interface ExecutionScope {
  id: string;
  workspaceId: string;
  agentId: string;
  allowedCapabilities: string[];
  allowedTools: string[];
  maxRetries: number;
}

export class AgentOrchestrator {
  constructor(private registry: AgentRegistry) {}

  selectAgentForCapability(
    capability: string,
    workspaceId: string,
  ): RegisteredAgent | undefined {
    const candidates = this.registry.findAgentsByCapability(
      capability,
      workspaceId,
    );
    return candidates[0];
  }

  createExecutionScope(params: {
    workspaceId: string;
    agentId: string;
    capabilities: string[];
    tools: string[];
    maxRetries?: number;
  }): ExecutionScope {
    return {
      id: `scope_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      allowedCapabilities: params.capabilities,
      allowedTools: params.tools,
      maxRetries: params.maxRetries ?? 3,
    };
  }
}
