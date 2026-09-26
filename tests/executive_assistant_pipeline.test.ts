import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperatorWebServer } from "../src/web/server.js";
import { OperatorApiHandler } from "../src/api/operator.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";
import { DeterministicBrain } from "../src/core/brain/index.js";
import { CapabilityResolver } from "../src/core/capability/index.js";
import { AgentRegistry } from "../src/core/agent/index.js";

describe("Executive Assistant Intelligence Pipeline & Entity Resolution Suite", () => {
  let server: OperatorWebServer;
  let baseUrl: string;
  let apiHandler: OperatorApiHandler;
  const token = "executive-assistant-test-token-456";

  beforeEach(async () => {
    apiHandler = await bootstrapOperatorApplication({
      ownerId: "owner_sohrab",
      bearerToken: token,
      defaultWorkspaceId: "yartrader",
      useInMemoryStores: true,
      dbPath: ":memory:",
      resourcesPath: "config/resources.example.json",
    });

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      corsOrigin: "http://127.0.0.1:3000",
      apiHandler,
    });

    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("1. Resolves natural language GitHub goal without raw tool name ('گیت هاب یارتریدر رو چک کن')", async () => {
    const brain = new DeterministicBrain();
    const registry = new AgentRegistry();
    registry.registerAgent({
      id: "github_agent",
      name: "GitHub Agent",
      capabilities: ["github_operate"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["github_operate"],
      provider: "LocalProvider",
      model: "local-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const resolver = new CapabilityResolver(registry);

    const brainRes = brain.interpret({
      rawCommandText: "گیت هاب یارتریدر رو چک کن",
    });

    expect(brainRes.intent).toBe("ACTION");
    expect(brainRes.actionGoal).toBe("INVESTIGATION");

    const capRes = resolver.resolve({
      brainResult: brainRes,
      workspaceId: "yartrader",
      rawCommandText: "گیت هاب یارتریدر رو چک کن",
    });

    expect(capRes.status).toBe("RESOLVED");
    expect(capRes.resolvedCapability).toBe("github_operate");
    expect(capRes.resolvedToolId).toBe("github_operate");
  });

  it("2. Resolves natural language YarTrader goal without raw tool name ('یارتریدر رو بررسی کن')", async () => {
    const brain = new DeterministicBrain();
    const registry = new AgentRegistry();
    registry.registerAgent({
      id: "yartrader_agent",
      name: "YarTrader Agent",
      capabilities: ["yartrader_adapter"],
      workspaceScopes: ["yartrader"],
      toolScopes: ["yartrader_adapter"],
      provider: "LocalProvider",
      model: "local-v1",
      contract: { inputSchema: {}, outputSchema: {} },
      available: true,
    });

    const resolver = new CapabilityResolver(registry);

    const brainRes = brain.interpret({
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(brainRes.intent).toBe("ACTION");
    expect(brainRes.actionGoal).toBe("INVESTIGATION");

    const capRes = resolver.resolve({
      brainResult: brainRes,
      workspaceId: "yartrader",
      rawCommandText: "یارتریدر رو بررسی کن",
    });

    expect(capRes.status).toBe("RESOLVED");
    expect(capRes.resolvedCapability).toBe("yartrader_adapter");
    expect(capRes.resolvedToolId).toBe("yartrader_adapter");
  });

  it("3. Returns context-aware clarification for ambiguous prompt ('بررسیش کن')", async () => {
    const brain = new DeterministicBrain();
    const brainRes = brain.interpret({ rawCommandText: "بررسیش کن" });

    expect(brainRes.intent).toBe("AMBIGUOUS");
    expect(brainRes.reason).toContain("دستور شما مبهم است");
    expect(brainRes.reason).toContain("یارتریدر");
  });

  it("4. End-to-End Chat API resolves natural language YarTrader inspection goal and executes yartrader_adapter truthfully", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "یارتریدر رو بررسی کن",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.resolvedToolId).toBe("yartrader_adapter");
    expect(data.result.resolvedCapability).toBe("yartrader_adapter");
    expect(data.result.status).toBe("FAILED");
  });

  it("5. GitHub inspection reports NOT_CONFIGURED when GITHUB_TOKEN is missing in current environment", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "گیت هاب یارتریدر رو چک کن",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("FAILED");
    expect(data.result.details.executedSteps[0].error).toContain("NOT_CONFIGURED");
  });

  it("6. Trading operation requests (e.g. order placement) are strictly BLOCKED by policy boundary", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن سفارش خرید طلا",
        targetCapability: "yartrader_adapter",
        requestedToolId: "yartrader_adapter",
        params: { action: "order_place" },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("BLOCKED");
    expect(data.result.details.executedSteps[0].status).toBe("BLOCKED");
  });

  it("7. Service state mutation requests (e.g. restart_service) require explicit owner approval", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operator/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workspaceId: "yartrader",
        environmentId: "env_yartrader",
        rawCommandText: "اجرا کن ریستارت سرویس",
        targetCapability: "yartrader_adapter",
        requestedToolId: "yartrader_adapter",
        params: { action: "restart_service" },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.status).toBe("APPROVAL_REQUIRED");
  });
});
