export type MemoryType = "SHORT" | "WORKSPACE" | "DECISION" | "EXPERIENCE";

export interface DecisionDetails {
  decision: string;
  reason: string;
  alternatives?: string[];
  outcome?: string;
  lesson?: string;
}

export interface MemoryRecord {
  id: string;
  workspaceId?: string;
  type: MemoryType;
  content: string;
  decisionDetails?: DecisionDetails;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryScope {
  workspaceId?: string;
  type?: MemoryType;
}

export interface MemoryStore {
  save(record: MemoryRecord): Promise<void>;
  get(id: string): Promise<MemoryRecord | undefined>;
  query(scope: MemoryScope): Promise<MemoryRecord[]>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private records = new Map<string, MemoryRecord>();

  async save(record: MemoryRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.records.get(id);
  }

  async query(scope: MemoryScope): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const record of this.records.values()) {
      if (
        scope.workspaceId &&
        record.workspaceId &&
        record.workspaceId !== scope.workspaceId
      ) {
        continue;
      }
      if (scope.type && record.type !== scope.type) {
        continue;
      }
      results.push(record);
    }
    return results;
  }
}

export class MemoryManager {
  constructor(private store: MemoryStore = new InMemoryMemoryStore()) {}

  async createMemory(
    type: MemoryType,
    content: string,
    workspaceId?: string,
    decisionDetails?: DecisionDetails,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId,
      type,
      content,
      decisionDetails,
      metadata,
      createdAt: new Date(),
    };

    await this.store.save(record);
    return record;
  }

  async getMemory(id: string): Promise<MemoryRecord | undefined> {
    return this.store.get(id);
  }

  async getWorkspaceMemories(
    workspaceId: string,
    type?: MemoryType,
  ): Promise<MemoryRecord[]> {
    return this.store.query({ workspaceId, type });
  }

  async queryScope(scope: MemoryScope): Promise<MemoryRecord[]> {
    return this.store.query(scope);
  }
}
