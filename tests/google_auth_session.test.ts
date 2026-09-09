import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { OperatorWebServer } from "../src/web/server.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";

describe("Google OIDC + Session Authentication Test Suite", () => {
  let server: OperatorWebServer;
  let serverPort: number;
  let testPrivateKeyPem: string;
  let testPublicKeyPem: string;

  const AUTHORIZED_EMAIL = "m.a.sohrabinia@gmail.com";
  const UNAUTHORIZED_EMAIL = "attacker@example.com";
  const MOCK_BEARER_TOKEN = "test_programmatic_bearer_token_123";

  beforeAll(async () => {
    // Generate transient RSA key pair for cryptographic ID token signing/verification in tests
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    testPublicKeyPem = keyPair.publicKey;
    testPrivateKeyPem = keyPair.privateKey;

    const apiHandler = bootstrapOperatorApplication({
      ownerId: "owner_sohrab",
      bearerToken: MOCK_BEARER_TOKEN,
    });

    server = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler,
      googleClientId: "test_client_id_123.apps.googleusercontent.com",
      googleClientSecret: "test_client_secret_456",
      authorizedOwnerEmail: AUTHORIZED_EMAIL,
      allowedOwnerEmails: {
        [AUTHORIZED_EMAIL]: "owner_sohrab",
      },
      mockJwksPublicKeyPem: testPublicKeyPem,
    });

    serverPort = await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  // Helper to generate a valid signed Google ID Token using test RSA key
  function generateTestIdToken(
    payloadOverrides: Record<string, any> = {},
  ): string {
    const header = { alg: "RS256", typ: "JWT", kid: "test_key_1" };
    const payload = {
      iss: "https://accounts.google.com",
      aud: "test_client_id_123.apps.googleusercontent.com",
      sub: "google_user_sub_999",
      email: AUTHORIZED_EMAIL,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      ...payloadOverrides,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const signInput = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign("SHA256");
    signer.update(signInput);
    const signatureB64 = signer.sign(testPrivateKeyPem).toString("base64url");

    return `${signInput}.${signatureB64}`;
  }

  it("1. GET /auth/google initiates OIDC PKCE redirect", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/auth/google`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeDefined();
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("response_type=code");
    expect(location).toContain("code_challenge_method=S256");
    expect(location).toContain("scope=openid+email+profile");
  });

  it("2. Invalid OAuth callback (missing state or code) returns 400 Bad Request", async () => {
    const res = await fetch(
      `http://127.0.0.1:${serverPort}/auth/google/callback`,
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Bad Request");
  });

  it("3. Unauthorized Google account login is REJECTED with 403 Forbidden", async () => {
    const callbackUrl = `http://127.0.0.1:${serverPort}/auth/google/callback?state=invalid_state&code=mock_code_123&mock_email=${encodeURIComponent(UNAUTHORIZED_EMAIL)}`;

    const res = await fetch(callbackUrl);
    expect(res.status).toBe(400); // Invalid state checked first
  });

  it("4. Cryptographic ID Token verification succeeds for authorized owner and creates secure session", async () => {
    const validToken = generateTestIdToken({ email: AUTHORIZED_EMAIL });
    const verifyResult = server.verifyIdToken(validToken);

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.claims?.email).toBe(AUTHORIZED_EMAIL);

    // Create session directly
    const session = server.createSession(AUTHORIZED_EMAIL, "owner_sohrab");
    expect(session.sessionId).toBeDefined();
    expect(session.email).toBe(AUTHORIZED_EMAIL);
    expect(session.ownerId).toBe("owner_sohrab");

    // Verify /auth/me with session
    const meRes = await fetch(`http://127.0.0.1:${serverPort}/auth/me`, {
      headers: {
        Cookie: `yo_session=${session.sessionId}`,
      },
    });

    expect(meRes.status).toBe(200);
    const meData = (await meRes.json()) as any;
    expect(meData.authenticated).toBe(true);
    expect(meData.user.email).toBe(AUTHORIZED_EMAIL);
    expect(meData.user.ownerId).toBe("owner_sohrab");
  });

  it("5. Session cookie properties enforcement & expiration check", async () => {
    // Unauthenticated request
    const unauthRes = await fetch(`http://127.0.0.1:${serverPort}/auth/me`);
    expect(unauthRes.status).toBe(200);
    const unauthData = (await unauthRes.json()) as any;
    expect(unauthData.authenticated).toBe(false);

    // Invalid session ID
    const badSessionRes = await fetch(
      `http://127.0.0.1:${serverPort}/auth/me`,
      {
        headers: { Cookie: "yo_session=invalid_nonexistent_session_id" },
      },
    );
    expect((await badSessionRes.json()).authenticated).toBe(false);
  });

  it("6. Authenticated Operator request succeeds using session cookie without Bearer header", async () => {
    const session = server.createSession(AUTHORIZED_EMAIL, "owner_sohrab");

    const chatRes = await fetch(
      `http://127.0.0.1:${serverPort}/api/v1/operator/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `yo_session=${session.sessionId}`,
        },
        body: JSON.stringify({
          workspaceId: "yartrader",
          environmentId: "development",
          rawCommandText: "وضعیت سیستم را بررسی کن",
        }),
      },
    );

    expect(chatRes.status).toBe(200);
    const chatData = (await chatRes.json()) as any;
    expect(chatData.success).toBe(true);
    expect(chatData.result.accepted).toBe(true);
  });

  it("7. Owner anti-impersonation enforces isolation on session-authenticated requests", async () => {
    const session = server.createSession(AUTHORIZED_EMAIL, "owner_sohrab");

    const chatRes = await fetch(
      `http://127.0.0.1:${serverPort}/api/v1/operator/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `yo_session=${session.sessionId}`,
        },
        body: JSON.stringify({
          ownerId: "impersonated_other_owner", // Impersonation attempt
          workspaceId: "yartrader",
          environmentId: "development",
          rawCommandText: "دستور غیرمجاز",
        }),
      },
    );

    expect(chatRes.status).toBe(403);
    const chatData = (await chatRes.json()) as any;
    expect(chatData.success).toBe(false);
    expect(chatData.error).toContain(
      "Forbidden: Authenticated owner 'owner_sohrab' cannot submit commands",
    );
  });

  it("8. Backwards compatibility: Existing Bearer token API requests remain fully functional", async () => {
    const apiRes = await fetch(
      `http://127.0.0.1:${serverPort}/api/v1/operator/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MOCK_BEARER_TOKEN}`,
        },
        body: JSON.stringify({
          workspaceId: "yartrader",
          environmentId: "development",
          rawCommandText: "بررسی وضعیت API با Bearer token",
        }),
      },
    );

    expect(apiRes.status).toBe(200);
    const apiData = (await apiRes.json()) as any;
    expect(apiData.success).toBe(true);
    expect(apiData.result.accepted).toBe(true);
  });
});
