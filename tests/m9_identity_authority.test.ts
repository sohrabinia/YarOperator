import { describe, it, expect, beforeEach } from "vitest";
import { IdentityStore, generateUlid } from "../src/core/identity/index.js";
import { OperatorWebServer } from "../src/web/server.js";
import { OperatorApiHandler } from "../src/api/operator.js";
import { OwnerCommandReceiver, OwnerManager } from "../src/core/owner/index.js";
import { PolicyEngine } from "../src/core/policy/index.js";
import { WorkspacePolicyManager } from "../src/core/workspace/policy.ts";

describe("M9 Identity Authority Specification Test Suite", () => {
  let identityStore: IdentityStore;

  beforeEach(() => {
    identityStore = new IdentityStore(":memory:");
  });

  it("1. Generates random immutable user_id with usr_ prefix (ULID format)", () => {
    const userId1 = generateUlid();
    const userId2 = generateUlid();

    expect(userId1).toMatch(/^usr_[A-Z0-9]+$/);
    expect(userId2).toMatch(/^usr_[A-Z0-9]+$/);
    expect(userId1).not.toBe(userId2);
  });

  it("2. User ID is immutable and independent of primary_email or provider_sub", () => {
    const user = identityStore.createUser({
      primaryEmail: "test@example.com",
      displayName: "Test User",
    });

    const binding = identityStore.bindProvider({
      userId: user.userId,
      provider: "google",
      providerSub: "google_sub_12345",
      emailAtBinding: "test@example.com",
    });

    expect(user.userId).not.toContain("test@example.com");
    expect(user.userId).not.toContain("google_sub_12345");
    expect(binding.userId).toBe(user.userId);
  });

  it("3. OIDC provider_sub authoritative resolution returns correct user", () => {
    const user = identityStore.createUser({
      primaryEmail: "sohrab@example.com",
    });

    identityStore.bindProvider({
      userId: user.userId,
      provider: "google",
      providerSub: "google_sub_99999",
      emailAtBinding: "sohrab@example.com",
    });

    const resolved = identityStore.getUserByProviderSub(
      "google",
      "google_sub_99999",
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.userId).toBe(user.userId);
  });

  it("4. Rejects duplicate Google provider_sub bindings (UNIQUE constraint)", () => {
    const user1 = identityStore.createUser({ primaryEmail: "u1@example.com" });
    const user2 = identityStore.createUser({ primaryEmail: "u2@example.com" });

    identityStore.bindProvider({
      userId: user1.userId,
      provider: "google",
      providerSub: "sub_shared",
      emailAtBinding: "u1@example.com",
    });

    expect(() => {
      identityStore.bindProvider({
        userId: user2.userId,
        provider: "google",
        providerSub: "sub_shared",
        emailAtBinding: "u2@example.com",
      });
    }).toThrow();
  });

  it("5. Workspace active membership check permits active members and denies non-members", () => {
    const user = identityStore.createUser({
      primaryEmail: "owner@example.com",
    });
    identityStore.createWorkspace({
      workspaceId: "ws_auth",
      name: "Authorized Workspace",
      ownerUserId: user.userId,
    });

    expect(
      identityStore.isUserActiveWorkspaceMember(user.userId, "ws_auth"),
    ).toBe(true);
    expect(
      identityStore.isUserActiveWorkspaceMember(
        "usr_random_stranger",
        "ws_auth",
      ),
    ).toBe(false);
  });

  it("6. Explicit environment ID requirement fails closed when missing", async () => {
    const ownerManager = new OwnerManager();
    const policyEngine = new PolicyEngine();
    const receiver = new OwnerCommandReceiver(ownerManager, policyEngine);

    const result = await receiver.receiveCommand({
      commandId: "cmd_no_owner",
      ownerId: "", // Empty / missing owner
      workspaceId: "yartrader",
      rawCommandText: "status",
      timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("Missing owner context");
  });

  it("7. Legacy owner_sohrab one-time migration creates active user and default workspaces", () => {
    const user = identityStore.migrateLegacyOwnerSohrab(
      "m.a.sohrabinia@gmail.com",
    );

    expect(user.userId).toBeDefined();
    expect(user.primaryEmail).toBe("m.a.sohrabinia@gmail.com");
    expect(
      identityStore.isUserActiveWorkspaceMember(user.userId, "yartrader"),
    ).toBe(true);
    expect(
      identityStore.isUserActiveWorkspaceMember(user.userId, "ws_default"),
    ).toBe(true);
  });
});
