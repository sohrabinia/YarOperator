import { OperatorApiHandler } from "../../api/operator.js";
import { OwnerManager, OwnerCommandReceiver } from "../owner/index.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { AuditManager } from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { ControlledAutonomyEngine } from "../autonomy/index.js";
import { RealWorldAssistant } from "../assistant/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { TerminalTool } from "../terminal/index.js";
import { GitTool } from "../git/index.js";
import { BrowserTool } from "../browser/index.js";
import { WebResearchTool } from "../research/index.js";
import { AgentRegistry } from "../agent/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { AcceptanceEngine } from "../acceptance/index.js";

export interface BootstrapOptions {
  ownerId?: string;
  ownerName?: string;
  defaultWorkspaceId?: string;
  bearerToken?: string;
  extraTokens?: Record<string, string>;
}

export function bootstrapOperatorApplication(
  options?: BootstrapOptions,
): OperatorApiHandler {
  const ownerManager = new OwnerManager();
  const approvalManager = new ApprovalManager();
  const policyEngine = new PolicyEngine(approvalManager);
  const auditManager = new AuditManager();
  const notificationManager = new NotificationManager();
  const toolEcosystem = new SecureToolEcosystem();
  const acceptanceEngine = new AcceptanceEngine();
  const agentRegistry = new AgentRegistry();
  const orchestrator = new AgentOrchestrator(agentRegistry);

  // Register default production tools
  toolEcosystem.registerTool(new TerminalTool());
  toolEcosystem.registerTool(new GitTool());
  toolEcosystem.registerTool(new BrowserTool());
  toolEcosystem.registerTool(new WebResearchTool());

  // Register default assistant agent
  agentRegistry.registerAgent({
    id: "default_assistant_agent",
    name: "Default Assistant Agent",
    capabilities: [
      "software-development",
      "web-research",
      "terminal-execution",
    ],
    workspaceScopes: ["yartrader", "ws_default"],
    toolScopes: [
      "terminal_execute",
      "git_operate",
      "browser_navigate",
      "web_research",
    ],
    provider: "DefaultProvider",
    model: "default-v1",
    contract: { inputSchema: {}, outputSchema: {} },
    available: true,
  });

  const autonomyEngine = new ControlledAutonomyEngine(
    orchestrator,
    policyEngine,
    approvalManager,
    toolEcosystem,
    acceptanceEngine,
    auditManager,
    notificationManager,
  );

  const assistant = new RealWorldAssistant(
    orchestrator,
    policyEngine,
    autonomyEngine,
    auditManager,
    notificationManager,
  );

  const activeOwnerId =
    options?.ownerId || process.env.OPERATOR_OWNER_ID || "owner_default";

  const activeWorkspaceId =
    options?.defaultWorkspaceId ||
    process.env.OPERATOR_WORKSPACE_ID ||
    "yartrader";

  ownerManager.createProfile({
    id: activeOwnerId,
    name: options?.ownerName || "Owner",
    defaultWorkspaceId: activeWorkspaceId,
  });

  const receiver = new OwnerCommandReceiver(
    ownerManager,
    policyEngine,
    auditManager,
    assistant,
    orchestrator,
    toolEcosystem,
  );

  const tokenMap: Record<string, string> = { ...options?.extraTokens };
  const token = options?.bearerToken || process.env.OPERATOR_OWNER_TOKEN;
  if (token) {
    tokenMap[token] = activeOwnerId;
  }

  return new OperatorApiHandler(receiver, tokenMap);
}
