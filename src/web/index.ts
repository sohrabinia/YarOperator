import path from "node:path";
import { OperatorWebServer } from "./server.js";
import { OperatorApiHandler } from "../api/operator.js";
import { OwnerManager, OwnerCommandReceiver } from "../core/owner/index.js";
import { PolicyEngine, ApprovalManager } from "../core/policy/index.js";
import { AuditManager } from "../core/audit/index.js";
import { NotificationManager } from "../core/notification/index.js";
import { ControlledAutonomyEngine } from "../core/autonomy/index.js";
import { RealWorldAssistant } from "../core/assistant/index.js";
import { SecureToolEcosystem } from "../core/tools/index.js";
import { TerminalTool } from "../core/terminal/index.js";
import { GitTool } from "../core/git/index.js";
import { BrowserTool } from "../core/browser/index.js";
import { WebResearchTool } from "../core/research/index.js";
import { AgentRegistry } from "../core/agent/index.js";
import { AgentOrchestrator } from "../core/orchestrator/index.js";
import { AcceptanceEngine } from "../core/acceptance/index.js";

export async function createProductionServer(options?: {
  port?: number;
  host?: string;
  bearerToken?: string;
}): Promise<{ server: OperatorWebServer; port: number }> {
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

  ownerManager.createProfile({
    id: "owner_sohrab",
    name: "Sohrab",
    defaultWorkspaceId: "yartrader",
  });

  const receiver = new OwnerCommandReceiver(
    ownerManager,
    policyEngine,
    auditManager,
    assistant,
    orchestrator,
    toolEcosystem,
  );

  agentRegistry.registerAgent({
    id: "jules_autonomy_agent",
    name: "YarOperator Assistant Agent",
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
    provider: "JulesProvider",
    model: "jules-v1",
    contract: { inputSchema: {}, outputSchema: {} },
    available: true,
  });

  const token =
    options?.bearerToken ||
    process.env.OPERATOR_OWNER_TOKEN ||
    "owner-secret-token-123";

  const apiHandler = new OperatorApiHandler(receiver, {
    [token]: "owner_sohrab",
  });

  const targetPort =
    options?.port !== undefined
      ? options.port
      : parseInt(process.env.PORT || "3000", 10);

  const targetHost = options?.host || process.env.HOST || "127.0.0.1";

  const server = new OperatorWebServer({
    port: targetPort,
    host: targetHost,
    apiHandler,
  });

  const actualPort = await server.start();
  return { server, port: actualPort };
}

// Directly executed via node ./dist/web/index.js
if (
  process.argv[1] &&
  path.normalize(process.argv[1]).endsWith(path.normalize("web/index.js"))
) {
  createProductionServer()
    .then(({ server, port }) => {
      console.log(
        `[YarOperator] Web Server running at http://${server.getHost()}:${port}/Operator`,
      );

      const shutdown = async () => {
        console.log("\n[YarOperator] Gracefully shutting down web server...");
        await server.stop();
        console.log("[YarOperator] Server stopped.");
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error("[YarOperator] Server startup failed:", err);
      process.exit(1);
    });
}
