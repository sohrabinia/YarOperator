export interface AgentContract {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface RegisteredAgent {
  id: string;
  name: string;
  capabilities: string[];
  workspaceScopes: string[];
  toolScopes: string[];
  provider: string;
  model: string;
  contract: AgentContract;
  available: boolean;
}

export class AgentRegistry {
  private agents = new Map<string, RegisteredAgent>();

  registerAgent(agent: RegisteredAgent): void {
    if (!agent.id || !agent.name) {
      throw new Error("Agent requires valid id and name.");
    }
    this.agents.set(agent.id, agent);
  }

  getAgent(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  findAgentsByCapability(
    capability: string,
    workspaceId?: string,
  ): RegisteredAgent[] {
    return Array.from(this.agents.values()).filter((a) => {
      if (!a.available) return false;
      if (!a.capabilities.includes(capability)) return false;
      if (
        workspaceId &&
        a.workspaceScopes.length > 0 &&
        !a.workspaceScopes.includes(workspaceId)
      ) {
        return false;
      }
      return true;
    });
  }
}
