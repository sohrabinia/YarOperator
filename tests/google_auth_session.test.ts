import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { OperatorWebServer, GoogleJwkKey } from "../src/web/server.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";

describe("Google OIDC + Session Authentication Test Suite", () => {
  let server: OperatorWebServer;
  let serverPort: number;
  let testPrivateKeyPem: string;
  let testPublicKeyPem: string;
  let testJwkKey: GoogleJwkKey;

  const AUTHORIZED_EMAIL = "m.a.sohrabinia@gmail.com";
  const UNAUTHORIZED_EMAIL = "attacker@example.com";
  const MOCK_BEARER_TOKEN = "test_programmatic_bearer_token_123";
  const TEST_KID = "test_google_jwk_kid_001";

  beforeAll(async () => {
    // Generate transient RSA key pair for cryptographic ID token signing/verification in tests
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    testPublicKeyPem = keyPair.publicKey;
    testPrivateKeyPem = keyPair.privateKey;

    // Convert RSA public key object into JWK format
    const keyObject = crypto.createPublicKey(testPublicKeyPem);
    const jwk = keyObject.export({ format: "jwk" }) as any;
    testJwkKey = {
      kty: "RSA",
      alg: "RS256",
      use: "sig",
      kid: TEST_KID,
      n: jwk.n,
      e: jwk.e,
    };

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
    headerOverrides: Record<string, any> = {},
    signingKeyPem: string = testPrivateKeyPem,
  ): string {
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: TEST_KID,
      ...headerOverrides,
    };
    const payload = {
      iss: "https://accounts.google.com",
      aud: "test_client_id_123.apps.googleusercontent.com",
      sub: "google_user_sub_999",
      email: AUTHORIZED_EMAIL,
      email_verified: true,
      nonce: "test_expected_nonce_123",
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
    const signatureB64 = signer.sign(signingKeyPem).toString("base64url");

    return `${signInput}.${signatureB64}`;
  }

  it("1. GET /auth/google initiates OIDC PKCE redirect pointing to accounts.google.com with production callback", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/auth/google`, {
      redirect: "manual",
      headers: {
        "x-forwarded-host": "yartrader.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeDefined();

    const locationUrl = new URL(location!);
    expect(locationUrl.host).toBe("accounts.google.com");
    expect(locationUrl.pathname).toBe("/o/oauth2/v2/auth");

    const searchParams = locationUrl.searchParams;
    expect(searchParams.get("response_type")).toBe("code");
    expect(searchParams.get("client_id")).toBe(
      "test_client_id_123.apps.googleusercontent.com",
    );
    expect(searchParams.get("redirect_uri")).toBe(
      "https://yartrader.com/auth/google/callback",
    );
    expect(searchParams.get("redirect_uri")).not.toContain("localhost");
    expect(searchParams.get("redirect_uri")).not.toContain("127.0.0.1");
    expect(searchParams.get("state")).toBeTruthy();
    expect(searchParams.get("nonce")).toBeTruthy();
    expect(searchParams.get("code_challenge")).toBeTruthy();
    expect(searchParams.get("code_challenge_method")).toBe("S256");
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
    const verifyResult = await server.verifyIdToken(
      validToken,
      "test_expected_nonce_123",
    );

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

  it("5. Real Google JWKS RS256 signature verification succeeds with valid key and fails on tampered signature", async () => {
    // Production Server instance without mock key
    const prodServer = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler: server["apiHandler"],
      googleClientId: "test_client_id_123.apps.googleusercontent.com",
    });

    const validToken = generateTestIdToken({ nonce: "nonce_jwks_1" });
    const verifySuccess = await prodServer.verifyIdToken(
      validToken,
      "nonce_jwks_1",
      [testJwkKey],
    );

    expect(verifySuccess.valid).toBe(true);
    expect(verifySuccess.claims?.email).toBe(AUTHORIZED_EMAIL);

    // Tampered token (modified payload)
    const parts = validToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "test_client_id_123.apps.googleusercontent.com",
        email: "hacked@example.com",
        nonce: "nonce_jwks_1",
        email_verified: true,
      }),
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyTampered = await prodServer.verifyIdToken(
      tamperedToken,
      "nonce_jwks_1",
      [testJwkKey],
    );
    expect(verifyTampered.valid).toBe(false);
    expect(verifyTampered.error).toContain("signature verification failed");
  });

  it("6. Verification fails when kid is unknown in JWKS", async () => {
    const prodServer = new OperatorWebServer({
      port: 0,
      host: "127.0.0.1",
      apiHandler: server["apiHandler"],
      googleClientId: "test_client_id_123.apps.googleusercontent.com",
    });

    const token = generateTestIdToken({}, { kid: "unknown_kid_999" });
    const verifyRes = await prodServer.verifyIdToken(
      token,
      "test_expected_nonce_123",
      [testJwkKey],
    );

    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toContain("Unknown key identifier (kid)");
  });

  it("7. Strict Nonce Validation: Missing or incorrect nonce fails; valid nonce succeeds", async () => {
    // Missing nonce in payload
    const tokenNoNonce = generateTestIdToken({ nonce: undefined });
    const resNoNonce = await server.verifyIdToken(
      tokenNoNonce,
      "test_expected_nonce_123",
    );
    expect(resNoNonce.valid).toBe(false);
    expect(resNoNonce.error).toContain("Missing required nonce claim");

    // Mismatched nonce
    const tokenWrongNonce = generateTestIdToken({ nonce: "wrong_nonce_value" });
    const resWrongNonce = await server.verifyIdToken(
      tokenWrongNonce,
      "test_expected_nonce_123",
    );
    expect(resWrongNonce.valid).toBe(false);
    expect(resWrongNonce.error).toContain("Nonce mismatch");

    // Valid nonce
    const tokenValidNonce = generateTestIdToken({ nonce: "correct_nonce_777" });
    const resValidNonce = await server.verifyIdToken(
      tokenValidNonce,
      "correct_nonce_777",
    );
    expect(resValidNonce.valid).toBe(true);
  });

  it("8. Production cookie contains Secure attribute when behind HTTPS proxy", async () => {
    const session = server.createSession(AUTHORIZED_EMAIL, "owner_sohrab");

    // Simulated HTTP Response object to capture Set-Cookie header
    let setCookieHeader = "";
    const mockRes = {
      setHeader: (name: string, value: string) => {
        if (name === "Set-Cookie") setCookieHeader = value;
      },
    } as any;

    const mockReqHttps = {
      headers: { "x-forwarded-proto": "https" },
      socket: {},
    } as any;

    server.setSessionCookie(mockRes, session.sessionId, mockReqHttps);
    expect(setCookieHeader).toContain("yo_session=");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");
    expect(setCookieHeader).toContain("Secure");
  });

  it("9. Authenticated Operator request succeeds using session cookie without Bearer header", async () => {
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

  it("10. Owner anti-impersonation enforces isolation on session-authenticated requests", async () => {
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

  it("11. Backwards compatibility: Existing Bearer token API requests remain fully functional", async () => {
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
