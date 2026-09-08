import { Tool } from "../contracts/index.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.metadata.id)) {
      throw new Error(
        `Tool with ID '${tool.metadata.id}' is already registered.`,
      );
    }
    this.tools.set(tool.metadata.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
