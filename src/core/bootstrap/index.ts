import { OperatorApiHandler } from "../../api/operator.js";
import { OwnerManager, OwnerCommandReceiver } from "../owner/index.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import {
  AuditManager,
  AuditStore,
  InMemoryAuditStore,
  SQLiteAuditStore,
} from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { ControlledAutonomyEngine } from "../autonomy/index.js";
import { RealWorldAssistant } from "../assistant/index.js";
import { SecureToolEcosystem } from "../tools/index.js";
import { TerminalTool } from "../terminal/index.js";
import { GitTool, GitHubTool, JulesWorkerAdapter } from "../git/index.js";
import { BrowserTool } from "../browser/index.js";
import { WebResearchTool } from "../research/index.js";
import { AgentRegistry } from "../agent/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { AcceptanceEngine } from "../acceptance/index.js";
import { DurableOperationalMemory } from "../memory/index.js";
import { EnvironmentManager } from "../environment/index.js";

export interface BootstrapOptions {
  ownerId?: string;
  ownerName?: string;
  defaultWorkspaceId?: string;
  bearerToken?: string;
  extraTokens?: Record<string, string>;
  dbPath?: string;
  auditStore?: AuditStore;
  useInMemoryStores?: boolean;
}

export function bootstrapOperatorApplication(
  options?: BootstrapOptions,
): OperatorApiHandler {
  const ownerManager = new OwnerManager();
  const approvalManager = new ApprovalManager();
  const policyEngine = new PolicyEngine(approvalManager);

  const dbPath =
    options?.dbPath || process.env.OPERATOR_DB_PATH || "operator.db";

  const auditStore =
    options?.auditStore ||
    (options?.useInMemoryStores
      ? new InMemoryAuditStore()
      : new SQLiteAuditStore(dbPath));

  const auditManager = new AuditManager(auditStore);

  const operationalMemory = options?.useInMemoryStores
    ? new DurableOperationalMemory(":memory:")
    : new DurableOperationalMemory(dbPath);

  const activeWorkspaceId =
    options?.defaultWorkspaceId ||
    process.env.OPERATOR_WORKSPACE_ID ||
    "yartrader";

  const notificationManager = new NotificationManager();
  const toolEcosystem = new SecureToolEcosystem(
    undefined,
    policyEngine,
    approvalManager,
  );
  const acceptanceEngine = new AcceptanceEngine();
  const agentRegistry = new AgentRegistry();
  const orchestrator = new AgentOrchestrator(agentRegistry);

  // Register default production tools and policy rules
  policyEngine.setRule("git_operate", "SAFE");
  policyEngine.setRule("browser_navigate", "SAFE");
  policyEngine.setRule("web_research", "SAFE");

  const defaultTools = [
    new TerminalTool(),
    new GitTool(),
    new GitHubTool(),
    new JulesWorkerAdapter(),
    new BrowserTool(),
    new WebResearchTool(),
  ];

  const registeredToolIds: string[] = [];
  for (const t of defaultTools) {
    toolEcosystem.registerTool(t);
    registeredToolIds.push(t.metadata.id);
  }

  const environmentManager = new EnvironmentManager();

  // Register default production environments bound to authorized workspaces with concrete tool capabilities
  const defaultWorkspaces = Array.from(
    new Set([activeWorkspaceId, "yartrader", "ws_default"]),
  );

  for (const wsId of defaultWorkspaces) {
    environmentManager.registerEnvironment({
      id: `env_${wsId}`,
      name: `Production Environment (${wsId})`,
      type: "PRODUCTION",
      capabilities: registeredToolIds,
      accessScope: "workspace",
      riskLevel: "SAFE",
      healthy: true,
      metadata: { workspaceId: wsId },
    });
  }

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
    operationalMemory,
    environmentManager,
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
