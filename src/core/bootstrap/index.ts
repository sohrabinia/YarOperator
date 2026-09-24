import path from "node:path";
import { OperatorApiHandler } from "../../api/operator.js";
import { OwnerManager, OwnerCommandReceiver } from "../owner/index.js";
import { PolicyEngine, ApprovalManager } from "../policy/index.js";
import { IdentityStore } from "../identity/index.js";
import {
  AuditManager,
  AuditStore,
  InMemoryAuditStore,
  SQLiteAuditStore,
} from "../audit/index.js";
import { NotificationManager } from "../notification/index.js";
import { ControlledAutonomyEngine } from "../autonomy/index.js";
import { RealWorldAssistant } from "../assistant/index.js";
import {
  SecureToolEcosystem,
  OperatorHealthTool,
  SystemHealthProvider,
} from "../tools/index.js";
import { TerminalTool } from "../terminal/index.js";
import { GitTool, GitHubTool, JulesWorkerAdapter } from "../git/index.js";
import { BrowserTool } from "../browser/index.js";
import { WebResearchTool } from "../research/index.js";
import { AgentRegistry } from "../agent/index.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { AcceptanceEngine } from "../acceptance/index.js";
import { DurableOperationalMemory } from "../memory/index.js";
import { EnvironmentManager } from "../environment/index.js";
import {
  WorkspacePolicyManager,
  WorkspacePolicy,
} from "../workspace/policy.js";
import {
  ResourceRegistry,
  ResourceRegistryConfig,
} from "../registry/resource.js";
import { ResourceResolver } from "../registry/resolver.js";

export interface BootstrapOptions {
  ownerId?: string;
  ownerName?: string;
  defaultWorkspaceId?: string;
  bearerToken?: string;
  extraTokens?: Record<string, string>;
  dbPath?: string;
  auditStore?: AuditStore;
  useInMemoryStores?: boolean;
  resourceRegistryConfig?: ResourceRegistryConfig | string;
  resourcesPath?: string;
}

export function bootstrapOperatorApplication(
  options?: BootstrapOptions,
): OperatorApiHandler {
  const ownerManager = new OwnerManager();

  const isProd = process.env.NODE_ENV === "production";
  if (isProd && options?.useInMemoryStores) {
    throw new Error(
      "PRODUCTION SECURITY FAILURE: In-memory store overrides are strictly forbidden in production.",
    );
  }

  if (
    isProd &&
    options?.auditStore &&
    !(options.auditStore instanceof SQLiteAuditStore)
  ) {
    throw new Error(
      "PRODUCTION SECURITY FAILURE: Non-SQLite audit stores are strictly forbidden in production.",
    );
  }

  const rawDbPath =
    options?.dbPath || process.env.OPERATOR_DB_PATH || "operator.db";

  if (isProd && !path.isAbsolute(rawDbPath)) {
    throw new Error(
      `PRODUCTION SECURITY FAILURE: OPERATOR_DB_PATH ('${rawDbPath}') must resolve to an absolute path in production.`,
    );
  }

  const dbPath = rawDbPath;

  const approvalManager = options?.useInMemoryStores
    ? new ApprovalManager(":memory:")
    : new ApprovalManager(dbPath);

  const policyEngine = new PolicyEngine(approvalManager);
  const workspacePolicyManager = new WorkspacePolicyManager();

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

  const notificationManager = options?.useInMemoryStores
    ? new NotificationManager(":memory:")
    : new NotificationManager(dbPath);
  const environmentManager = new EnvironmentManager();

  const toolEcosystem = new SecureToolEcosystem(
    undefined,
    policyEngine,
    approvalManager,
    environmentManager,
    workspacePolicyManager,
  );
  const acceptanceEngine = new AcceptanceEngine();
  const agentRegistry = new AgentRegistry();
  const orchestrator = new AgentOrchestrator(agentRegistry);

  // Register default production tools and explicit canonical action policy rules
  policyEngine.setRule("browser_operate:navigate", "SAFE");
  policyEngine.setRule("git_operate:status", "SAFE");
  policyEngine.setRule("git_operate:diff", "SAFE");
  policyEngine.setRule("git_operate:branch_list", "SAFE");
  policyEngine.setRule("github_operate:get_pr", "SAFE");
  policyEngine.setRule("web_research:search", "SAFE");

  policyEngine.setRule("browser_operate:click", "APPROVAL_REQUIRED");
  policyEngine.setRule("browser_operate:fill", "APPROVAL_REQUIRED");
  policyEngine.setRule("git_operate:branch_create", "APPROVAL_REQUIRED");
  policyEngine.setRule("git_operate:branch_delete", "APPROVAL_REQUIRED");
  policyEngine.setRule("git_operate:commit", "APPROVAL_REQUIRED");
  policyEngine.setRule("git_operate:checkout", "APPROVAL_REQUIRED");
  policyEngine.setRule("git_operate:push", "APPROVAL_REQUIRED");
  policyEngine.setRule("github_operate:create_pr", "APPROVAL_REQUIRED");
  policyEngine.setRule("terminal_execute:run", "APPROVAL_REQUIRED");

  policyEngine.setRule("github_operate:merge_pr", "BLOCKED");

  policyEngine.setRule("operator_health:check", "SAFE");

  // Base tool fallback defaults for legacy toolId lookups
  policyEngine.setRule("operator_health", "SAFE");
  policyEngine.setRule("browser_operate", "SAFE");
  policyEngine.setRule("web_research", "SAFE");
  policyEngine.setRule("git_operate", "APPROVAL_REQUIRED");
  policyEngine.setRule("github_operate", "APPROVAL_REQUIRED");
  policyEngine.setRule("terminal_execute", "APPROVAL_REQUIRED");

  const identityStoreForApi = options?.useInMemoryStores
    ? new IdentityStore(":memory:")
    : new IdentityStore(dbPath);

  let receiver: OwnerCommandReceiver | undefined;
  let registryReady = false;
  let resourceRegistry: ResourceRegistry | undefined;
  let resourceResolver: ResourceResolver | undefined;

  try {
    const registryInput =
      options?.resourceRegistryConfig ||
      options?.resourcesPath ||
      process.env.OPERATOR_RESOURCES_PATH;

    if (registryInput) {
      resourceRegistry = new ResourceRegistry(registryInput, {
        skipFsCheck: options?.useInMemoryStores ?? false,
      });
    } else {
      // Default production configuration initialization
      const appRoot = process.cwd();
      resourceRegistry = new ResourceRegistry(
        {
          defaultWorkspaceId: activeWorkspaceId,
          workspaces: [
            {
              workspaceId: "yartrader",
              aliases: ["trader"],
              allowedRoots: [appRoot],
              repositories: [
                {
                  repositoryId: "sohrabinia/YarTrader",
                  workspaceId: "yartrader",
                  root: appRoot,
                },
              ],
              environments: [
                {
                  environmentId: "env_yartrader",
                  name: "YarTrader Primary Environment",
                },
              ],
            },
            {
              workspaceId: "ws_default",
              aliases: ["default"],
              allowedRoots: [appRoot],
              repositories: [
                {
                  repositoryId: "sohrabinia/YarOperator",
                  workspaceId: "ws_default",
                  root: appRoot,
                },
              ],
              environments: [
                {
                  environmentId: "env_ws_default",
                  name: "Default Operator Environment",
                },
              ],
            },
          ],
        },
        { skipFsCheck: options?.useInMemoryStores ?? false },
      );
    }

    resourceRegistry.auditBootstrap(auditManager).catch(() => {});
    resourceResolver = new ResourceResolver(resourceRegistry, auditManager);
    registryReady = true;
  } catch (err: any) {
    registryReady = false;
    auditManager
      .recordEvent(
        "REGISTRY_BOOTSTRAP_FAILURE",
        {
          error: err.message,
          configPathIdentifier:
            options?.resourcesPath ||
            process.env.OPERATOR_RESOURCES_PATH ||
            "in-memory",
        },
        { severity: "CRITICAL" },
      )
      .catch(() => {});
  }

  const sharedHealthProvider = new SystemHealthProvider(
    () => Boolean(receiver),
    () => identityStoreForApi,
    undefined,
    () => registryReady,
  );

  const healthTool = new OperatorHealthTool(sharedHealthProvider);

  const gitTool = new GitTool();
  const terminalTool = new TerminalTool();
  if (resourceResolver) {
    gitTool.setResourceResolver(resourceResolver);
    terminalTool.setResourceResolver(resourceResolver);
    toolEcosystem.setResourceResolver(resourceResolver);
  }

  const defaultTools = [
    terminalTool,
    gitTool,
    new GitHubTool(),
    new JulesWorkerAdapter(),
    new BrowserTool(),
    new WebResearchTool(),
    healthTool,
  ];

  const registeredToolIds: string[] = [];
  for (const t of defaultTools) {
    toolEcosystem.registerTool(t);
    registeredToolIds.push(t.metadata.id);
  }

  // Register default production workspace policies & environments
  const defaultWorkspaces = Array.from(
    new Set([activeWorkspaceId, "yartrader", "ws_default"]),
  );

  for (const wsId of defaultWorkspaces) {
    workspacePolicyManager.registerPolicy(
      new WorkspacePolicy({
        workspaceId: wsId,
        allowedTools: registeredToolIds,
        allowedRoots: [process.cwd()],
      }),
    );

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
      "web-browsing",
      "terminal-execution",
      "system-monitoring",
    ],
    workspaceScopes: ["yartrader", "ws_default"],
    toolScopes: [
      "terminal_execute",
      "git_operate",
      "browser_operate",
      "web_research",
      "operator_health",
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

  receiver = new OwnerCommandReceiver(
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

  const apiHandler = new OperatorApiHandler(
    receiver,
    undefined,
    identityStoreForApi,
    sharedHealthProvider,
  );
  for (const [t, oId] of Object.entries(tokenMap)) {
    apiHandler.registerBearerToken(t, oId);
  }

  return apiHandler;
}
