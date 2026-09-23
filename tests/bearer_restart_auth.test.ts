import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperatorApiHandler } from "../src/api/operator.js";
import { IdentityStore } from "../src/core/identity/index.js";
import { OwnerCommandReceiver } from "../src/core/owner/index.js";
import { unlinkSync, existsSync } from "node:fs";

describe("Phase 1: Persistent Bearer & Session Authentication", () => {
  const dbPath = "test_bearer_restart_auth.db";
  let identityStore: IdentityStore;
  let mockReceiver: OwnerCommandReceiver;

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    identityStore = new IdentityStore(dbPath);
    mockReceiver = {
      receiveCommand: async (input: any) => ({
        commandId: input.commandId,
        accepted: true,
        commandTextPreserved: input.rawCommandText,
      }),
    } as any;
  });

  afterEach(() => {
    try {
      identityStore.close();
    } catch {}
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("1. valid token works before restart and after handler reconstruction from persistent DB", async () => {
    const handler1 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStore,
    );
    handler1.registerBearerToken("token_valid_123", "owner_sohrab");

    const req = {
      headers: { authorization: "Bearer token_valid_123" },
      body: {
        workspaceId: "yartrader",
        rawCommandText: "status check",
      },
    };

    const res1 = await handler1.handleChatRequest(req);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);

    identityStore.close();
    const identityStoreRehydrated = new IdentityStore(dbPath);
    const handler2 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStoreRehydrated,
    );

    const res2 = await handler2.handleChatRequest(req);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.success).toBe(true);

    identityStoreRehydrated.close();
  });

  it("2. expired token remains rejected after restart", async () => {
    const user = identityStore.createUser({
      userId: "owner_sohrab",
      primaryEmail: "sohrab@example.com",
    });
    identityStore.createSession({
      sessionId: "token_expired_123",
      userId: user.userId,
      ownerId: "owner_sohrab",
      ttlMs: -3600 * 1000,
    });

    identityStore.close();

    const rehydratedStore = new IdentityStore(dbPath);
    const handler = new OperatorApiHandler(
      mockReceiver,
      undefined,
      rehydratedStore,
    );

    const req = {
      headers: { authorization: "Bearer token_expired_123" },
      body: { workspaceId: "yartrader", rawCommandText: "ping" },
    };

    const res = await handler.handleChatRequest(req);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain("Invalid or expired");

    rehydratedStore.close();
  });

  it("3. revoked token remains rejected after restart", async () => {
    const handler1 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStore,
    );
    handler1.registerBearerToken("token_revoked_123", "owner_sohrab");

    identityStore.revokeSession("token_revoked_123");
    identityStore.close();

    const rehydratedStore = new IdentityStore(dbPath);
    const handler2 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      rehydratedStore,
    );

    const req = {
      headers: { authorization: "Bearer token_revoked_123" },
      body: { workspaceId: "yartrader", rawCommandText: "ping" },
    };

    const res = await handler2.handleChatRequest(req);
    expect(res.statusCode).toBe(401);

    rehydratedStore.close();
  });

  it("4. unknown token remains rejected", async () => {
    const handler = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStore,
    );

    const req = {
      headers: { authorization: "Bearer token_unknown_999" },
      body: { workspaceId: "yartrader", rawCommandText: "ping" },
    };

    const res = await handler.handleChatRequest(req);
    expect(res.statusCode).toBe(401);
  });

  it("5. token cannot authenticate a different owner and enforces owner boundary", async () => {
    const handler1 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      identityStore,
    );
    handler1.registerBearerToken("token_sohrab", "owner_sohrab");

    identityStore.close();
    const rehydratedStore = new IdentityStore(dbPath);
    const handler2 = new OperatorApiHandler(
      mockReceiver,
      undefined,
      rehydratedStore,
    );

    const req = {
      headers: { authorization: "Bearer token_sohrab" },
      body: {
        ownerId: "owner_attacker",
        workspaceId: "yartrader",
        rawCommandText: "unauthorized command",
      },
    };

    const res = await handler2.handleChatRequest(req);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain(
      "Authenticated owner 'owner_sohrab' cannot submit commands as owner 'owner_attacker'",
    );

    rehydratedStore.close();
  });
});
