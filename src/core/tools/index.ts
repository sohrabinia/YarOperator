import { ExecutionScope } from "../orchestrator/index.js";

export class SecureToolEcosystem {
  isToolAuthorized(toolId: string, scope: ExecutionScope): boolean {
    return scope.allowedTools.includes(toolId);
  }
}
