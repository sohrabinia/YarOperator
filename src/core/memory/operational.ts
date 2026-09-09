import { OperationalStateStore } from "../persistence/index.js";

export class OperationalMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalMemoryError";
  }
}

export interface OperationalStateEntry<T = Record<string, unknown>> {
  key: string;
  value: T;
  createdAt: string;
  updatedAt: string;
}

export class DurableOperationalMemory {
  private store: OperationalStateStore;
  private isExternalStore: boolean;

  constructor(storeOrDbPath: OperationalStateStore | string = ":memory:") {
    if (typeof storeOrDbPath === "string") {
      this.store = new OperationalStateStore(storeOrDbPath);
      this.isExternalStore = false;
    } else if (storeOrDbPath instanceof OperationalStateStore) {
      this.store = storeOrDbPath;
      this.isExternalStore = true;
    } else {
      throw new OperationalMemoryError(
        "Invalid storage initializer for DurableOperationalMemory.",
      );
    }
  }

  saveState<T extends Record<string, unknown>>(key: string, value: T): void {
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      throw new OperationalMemoryError(
        "Operational state key must be a non-empty string.",
      );
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new OperationalMemoryError(
        "Operational state value must be a valid non-null object.",
      );
    }

    try {
      this.store.set(key, value);
    } catch (err: any) {
      if (err instanceof Error && err.message.includes("Security Exception")) {
        throw new OperationalMemoryError(err.message);
      }
      throw new OperationalMemoryError(
        `Failed to save operational state: ${err?.message || String(err)}`,
      );
    }
  }

  getState<T extends Record<string, unknown>>(
    key: string,
  ): OperationalStateEntry<T> | null {
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      throw new OperationalMemoryError(
        "Operational state key must be a non-empty string.",
      );
    }

    try {
      const record = this.store.get(key);
      if (!record) return null;

      return {
        key: record.key,
        value: record.value as T,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch (err: any) {
      throw new OperationalMemoryError(
        `Failed to retrieve operational state for key '${key}': ${err?.message || String(err)}`,
      );
    }
  }

  hasState(key: string): boolean {
    return this.getState(key) !== null;
  }

  listKeys(prefix: string = ""): string[] {
    try {
      return this.store.listKeys(prefix);
    } catch (err: any) {
      throw new OperationalMemoryError(
        `Failed to list operational state keys: ${err?.message || String(err)}`,
      );
    }
  }

  deleteState(key: string): boolean {
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      throw new OperationalMemoryError(
        "Operational state key must be a non-empty string.",
      );
    }

    try {
      return this.store.delete(key);
    } catch (err: any) {
      throw new OperationalMemoryError(
        `Failed to delete operational state for key '${key}': ${err?.message || String(err)}`,
      );
    }
  }

  clearState(): void {
    try {
      this.store.clear();
    } catch (err: any) {
      throw new OperationalMemoryError(
        `Failed to clear operational state: ${err?.message || String(err)}`,
      );
    }
  }

  close(): void {
    if (!this.isExternalStore) {
      this.store.close();
    }
  }
}
