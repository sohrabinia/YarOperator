import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { OperatorApiHandler, OperatorApiRequest } from "../api/operator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SessionData {
  sessionId: string;
  googleSub?: string;
  email: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthStateData {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export interface GoogleIdTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean | string;
  nonce: string;
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
}

export interface GoogleJwkKey {
  kty: string;
  alg: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

export interface OperatorServerOptions {
  port?: number;
  host?: string;
  maxBodySizeBytes?: number;
  corsOrigin?: string;
  apiHandler: OperatorApiHandler;
  publicDir?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  authorizedOwnerEmail?: string;
  allowedOwnerEmails?: Record<string, string>;
  mockJwksPublicKeyPem?: string; // Optional RSA Public Key for test signature verification
}

export class OperatorWebServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private maxBodySizeBytes: number;
  private corsOrigin: string;
  private apiHandler: OperatorApiHandler;
  private publicDir: string;

  private googleClientId: string;
  private googleClientSecret: string;
  private googleRedirectUri: string;
  private authorizedOwnerEmail: string;
  private allowedOwnerEmails: Record<string, string>;
  private mockJwksPublicKeyPem?: string;

  private jwksCache: { keys: GoogleJwkKey[]; fetchedAt: number } | null = null;
  private sessions: Map<string, SessionData> = new Map();
  private authStates: Map<string, OAuthStateData> = new Map();

  constructor(options: OperatorServerOptions) {
    this.port = options.port !== undefined ? options.port : 3000;
    this.host = options.host || "127.0.0.1";
    this.maxBodySizeBytes = options.maxBodySizeBytes || 1024 * 1024; // 1 MiB default
    this.corsOrigin = options.corsOrigin || "http://127.0.0.1:3000";
    this.apiHandler = options.apiHandler;
    this.publicDir =
      options.publicDir || path.resolve(__dirname, "../../src/web/public");

    this.googleClientId =
      options.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
    this.googleClientSecret =
      options.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "";
    this.googleRedirectUri =
      options.googleRedirectUri ||
      process.env.GOOGLE_REDIRECT_URI ||
      `http://${this.host}:${this.port}/auth/google/callback`;

    // LOCKED AUTHORIZED GOOGLE ACCOUNT
    this.authorizedOwnerEmail = (
      options.authorizedOwnerEmail ||
      process.env.AUTHORIZED_OWNER_EMAIL ||
      "m.a.sohrabinia@gmail.com"
    ).toLowerCase();

    this.allowedOwnerEmails = options.allowedOwnerEmails || {
      [this.authorizedOwnerEmail]: "owner_sohrab",
    };

    this.mockJwksPublicKeyPem = options.mockJwksPublicKeyPem;
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("SERVER UNHANDLED ERROR:", err);
          if (!res.headersSent) {
            res.writeHead(500, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              JSON.stringify({
                success: false,
                error: "Internal Server Error",
              }),
            );
          }
        });
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort =
          typeof address === "object" && address ? address.port : this.port;
        this.port = actualPort;
        if (!this.googleRedirectUri) {
          this.googleRedirectUri = `http://${this.host}:${this.port}/auth/google/callback`;
        }
        resolve(actualPort);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  // Session Helper Methods
  public createSession(
    email: string,
    ownerId: string,
    googleSub?: string,
  ): SessionData {
    const sessionId = `sess_${crypto.randomBytes(32).toString("hex")}`;
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours

    const session: SessionData = {
      sessionId,
      googleSub,
      email: email.toLowerCase(),
      ownerId,
      createdAt: now,
      expiresAt,
    };

    this.sessions.set(sessionId, session);
    // Register session token with OperatorApiHandler so API handler recognizes it
    this.apiHandler.registerBearerToken(sessionId, ownerId);
    return session;
  }

  public getSession(sessionId?: string): SessionData | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  public revokeSession(sessionId?: string): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const list: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return list;

    cookieHeader.split(";").forEach((cookie) => {
      let [name, ...rest] = cookie.split("=");
      name = name?.trim();
      if (!name) return;
      const value = rest.join("=").trim();
      if (!value) return;
      list[name] = decodeURIComponent(value);
    });

    return list;
  }

  private extractSessionFromRequest(
    req: http.IncomingMessage,
  ): SessionData | null {
    const cookies = this.parseCookies(req);
    let sessionId = cookies["yo_session"];

    if (!sessionId && req.headers.authorization?.startsWith("Bearer ")) {
      sessionId = req.headers.authorization.replace("Bearer ", "").trim();
    }

    return this.getSession(sessionId);
  }

  public setSessionCookie(
    res: http.ServerResponse,
    sessionId: string,
    req: http.IncomingMessage,
  ): void {
    const isSecure =
      req.headers["x-forwarded-proto"] === "https" ||
      req.headers["x-forwarded-ssl"] === "on" ||
      (req.socket as any).encrypted === true ||
      process.env.NODE_ENV === "production";

    let cookieHeader = `yo_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
    if (isSecure) {
      cookieHeader += "; Secure";
    }
    res.setHeader("Set-Cookie", cookieHeader);
  }

  public clearSessionCookie(
    res: http.ServerResponse,
    req: http.IncomingMessage,
  ): void {
    const isSecure =
      req.headers["x-forwarded-proto"] === "https" ||
      req.headers["x-forwarded-ssl"] === "on" ||
      (req.socket as any).encrypted === true ||
      process.env.NODE_ENV === "production";

    let cookieHeader = `yo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    if (isSecure) {
      cookieHeader += "; Secure";
    }
    res.setHeader("Set-Cookie", cookieHeader);
  }

  // Google OIDC Public Key Fetching & Caching
  public async getGoogleJwksKeys(
    customJwksKeys?: GoogleJwkKey[],
  ): Promise<GoogleJwkKey[]> {
    if (customJwksKeys) {
      return customJwksKeys;
    }
    const now = Date.now();
    if (this.jwksCache && now - this.jwksCache.fetchedAt < 3600 * 1000) {
      return this.jwksCache.keys;
    }

    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) {
      throw new Error(`Failed to fetch Google JWKS: ${response.statusText}`);
    }

    const data = (await response.json()) as { keys: GoogleJwkKey[] };
    this.jwksCache = { keys: data.keys, fetchedAt: now };
    return data.keys;
  }

  // Cryptographic OIDC ID Token Verification
  public async verifyIdToken(
    idToken: string,
    expectedNonce: string,
    customJwksKeys?: GoogleJwkKey[],
  ): Promise<{ valid: boolean; error?: string; claims?: GoogleIdTokenClaims }> {
    try {
      if (!expectedNonce || typeof expectedNonce !== "string") {
        return {
          valid: false,
          error: "Expected nonce is required for verification.",
        };
      }

      const parts = idToken.split(".");
      if (parts.length !== 3) {
        return { valid: false, error: "Malformed ID Token structure." };
      }

      const [headerB64, payloadB64, sigB64] = parts;
      const header = JSON.parse(
        Buffer.from(headerB64, "base64url").toString("utf-8"),
      );
      const payload: GoogleIdTokenClaims = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8"),
      );

      // 1. Algorithm check
      if (header.alg !== "RS256") {
        return { valid: false, error: "Unsupported signing algorithm." };
      }

      // 2. Issuer check
      const validIssuers = [
        "https://accounts.google.com",
        "accounts.google.com",
      ];
      if (!validIssuers.includes(payload.iss)) {
        return { valid: false, error: `Invalid issuer '${payload.iss}'.` };
      }

      // 3. Audience check
      if (
        this.googleClientId &&
        payload.aud !== this.googleClientId &&
        !this.mockJwksPublicKeyPem
      ) {
        return { valid: false, error: `Invalid audience '${payload.aud}'.` };
      }

      // 4. Expiration check
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSeconds) {
        return { valid: false, error: "ID Token has expired." };
      }

      // 5. MANDATORY NONCE CHECK
      if (!payload.nonce || typeof payload.nonce !== "string") {
        return {
          valid: false,
          error: "Missing required nonce claim in ID Token.",
        };
      }

      if (payload.nonce !== expectedNonce) {
        return {
          valid: false,
          error: `Nonce mismatch: expected '${expectedNonce}', got '${payload.nonce}'.`,
        };
      }

      // 6. Email verification check
      const emailVerified =
        payload.email_verified === true || payload.email_verified === "true";
      if (!emailVerified) {
        return { valid: false, error: "Google email is not verified." };
      }

      // 7. REAL CRYPTOGRAPHIC RSA-SHA256 SIGNATURE VERIFICATION
      if (this.mockJwksPublicKeyPem) {
        // Test Mock Key Path
        const verifier = crypto.createVerify("SHA256");
        verifier.update(`${headerB64}.${payloadB64}`);
        const sigBuf = Buffer.from(sigB64, "base64url");
        const isSigValid = verifier.verify(this.mockJwksPublicKeyPem, sigBuf);

        if (!isSigValid) {
          return {
            valid: false,
            error: "Cryptographic signature verification failed.",
          };
        }
      } else {
        // Production Real Google JWKS Key Matching
        if (!header.kid) {
          return { valid: false, error: "Missing 'kid' in ID token header." };
        }

        const jwksKeys = await this.getGoogleJwksKeys(customJwksKeys);
        const matchingKey = jwksKeys.find((k) => k.kid === header.kid);

        if (!matchingKey) {
          return {
            valid: false,
            error: `Unknown key identifier (kid) '${header.kid}'.`,
          };
        }

        // Native Node.js crypto.createPublicKey convert JWK -> KeyObject
        const publicKey = crypto.createPublicKey({
          key: {
            kty: "RSA",
            n: matchingKey.n,
            e: matchingKey.e,
            alg: "RS256",
            use: "sig",
          },
          format: "jwk",
        });

        const verifier = crypto.createVerify("SHA256");
        verifier.update(`${headerB64}.${payloadB64}`);
        const sigBuf = Buffer.from(sigB64, "base64url");
        const isSigValid = verifier.verify(publicKey, sigBuf);

        if (!isSigValid) {
          return {
            valid: false,
            error:
              "Cryptographic signature verification failed against Google JWKS key.",
          };
        }
      }

      return { valid: true, claims: payload };
    } catch (err: any) {
      return {
        valid: false,
        error: `Token verification failed: ${err.message}`,
      };
    }
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const hostHeader = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = url.pathname;

    // Configured CORS origin handling
    res.setHeader("Access-Control-Allow-Origin", this.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // OIDC Route 1: GET /auth/google — Initiate OIDC Auth Flow (with proxy path aliases)
    if (
      (pathname === "/auth/google" ||
        pathname === "/Operator/auth/google" ||
        pathname === "/api/v1/operator/auth/google") &&
      req.method === "GET"
    ) {
      const state = crypto.randomBytes(24).toString("hex");
      const nonce = crypto.randomBytes(24).toString("hex");
      const codeVerifier = crypto.randomBytes(32).toString("hex");

      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      this.authStates.set(state, {
        state,
        nonce,
        codeVerifier,
        createdAt: Date.now(),
      });

      // Dynamic public redirect URI resolution if not explicitly overridden
      let effectiveRedirectUri = this.googleRedirectUri;
      const xHost =
        (req.headers["x-forwarded-host"] as string) ||
        (req.headers["host"] as string);
      const xProto = (req.headers["x-forwarded-proto"] as string) || "https";

      if (
        !process.env.GOOGLE_REDIRECT_URI &&
        xHost &&
        !xHost.includes("127.0.0.1") &&
        !xHost.includes("localhost")
      ) {
        effectiveRedirectUri = `${xProto}://${xHost}/auth/google/callback`;
      }

      const params = new URLSearchParams({
        response_type: "code",
        client_id: this.googleClientId,
        redirect_uri: effectiveRedirectUri,
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      res.writeHead(302, { Location: googleAuthUrl });
      res.end();
      return;
    }

    // OIDC Route 2: GET /auth/google/callback — Handle OAuth Callback (with proxy path aliases)
    if (
      (pathname === "/auth/google/callback" ||
        pathname === "/Operator/auth/google/callback" ||
        pathname === "/api/v1/operator/auth/google/callback") &&
      req.method === "GET"
    ) {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h3>Google OAuth Error: ${oauthError}</h3><a href="/">Return to Login</a>`,
        );
        return;
      }

      if (!state || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h3>Bad Request: Missing state or authorization code.</h3><a href="/">Return to Login</a>`,
        );
        return;
      }

      const stateData = this.authStates.get(state);
      if (!stateData) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h3>Invalid or expired state parameter (CSRF protection triggered).</h3><a href="/">Return to Login</a>`,
        );
        return;
      }

      // Consume state
      this.authStates.delete(state);

      try {
        let idToken = "";
        let claims: GoogleIdTokenClaims | undefined;

        // In mock mode / test mode or real Google token exchange
        if (this.mockJwksPublicKeyPem && code.startsWith("mock_code_")) {
          // Process mock callback for offline testing
          const mockEmail =
            url.searchParams.get("mock_email") || this.authorizedOwnerEmail;
          claims = {
            iss: "https://accounts.google.com",
            aud: this.googleClientId || "mock_client_id",
            sub: "mock_google_sub_123",
            email: mockEmail,
            email_verified: true,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            nonce: stateData.nonce,
          };
        } else {
          // Dynamic public redirect URI resolution for token exchange matching initiation
          let effectiveRedirectUri = this.googleRedirectUri;
          const xHost =
            (req.headers["x-forwarded-host"] as string) ||
            (req.headers["host"] as string);
          const xProto =
            (req.headers["x-forwarded-proto"] as string) || "https";

          if (
            !process.env.GOOGLE_REDIRECT_URI &&
            xHost &&
            !xHost.includes("127.0.0.1") &&
            !xHost.includes("localhost")
          ) {
            effectiveRedirectUri = `${xProto}://${xHost}/auth/google/callback`;
          }

          // Perform real Google OAuth token exchange
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: this.googleClientId,
              client_secret: this.googleClientSecret,
              redirect_uri: effectiveRedirectUri,
              grant_type: "authorization_code",
              code_verifier: stateData.codeVerifier,
            }).toString(),
          });

          if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              `<h3>OAuth Token Exchange Failed: ${errText}</h3><a href="/">Return</a>`,
            );
            return;
          }

          const tokenData = (await tokenRes.json()) as any;
          idToken = tokenData.id_token;

          const verifyRes = await this.verifyIdToken(idToken, stateData.nonce);
          if (!verifyRes.valid || !verifyRes.claims) {
            res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              `<h3>ID Token Verification Failed: ${verifyRes.error}</h3><a href="/">Return</a>`,
            );
            return;
          }
          claims = verifyRes.claims;
        }

        const authenticatedEmail = claims.email.toLowerCase();

        // STRICT AUTHORIZATION LOCK: Only authorized Google account allowed
        const mappedOwnerId = this.allowedOwnerEmails[authenticatedEmail];
        if (
          !mappedOwnerId ||
          authenticatedEmail !== this.authorizedOwnerEmail
        ) {
          console.warn(
            `[SECURITY ALERT] Unauthorized Google account login attempt: ${authenticatedEmail}`,
          );
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<h3>Access Denied: Google account '${authenticatedEmail}' is not authorized.</h3><p>Only the designated owner account is permitted access.</p><a href="/">Return to Login</a>`,
          );
          return;
        }

        // Create secure session
        const session = this.createSession(
          authenticatedEmail,
          mappedOwnerId,
          claims.sub,
        );

        this.setSessionCookie(res, session.sessionId, req);
        res.writeHead(302, { Location: "/Operator" });
        res.end();
        return;
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h3>Authentication Failed: ${err.message}</h3><a href="/">Return</a>`,
        );
        return;
      }
    }

    // OIDC Route 3: GET /auth/me — Check Session Status (with proxy path aliases)
    if (
      (pathname === "/auth/me" ||
        pathname === "/Operator/auth/me" ||
        pathname === "/api/v1/operator/auth/me") &&
      req.method === "GET"
    ) {
      const session = this.extractSessionFromRequest(req);
      if (!session) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ authenticated: false }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          authenticated: true,
          user: {
            email: session.email,
            ownerId: session.ownerId,
            expiresAt: new Date(session.expiresAt).toISOString(),
          },
        }),
      );
      return;
    }

    // OIDC Route 4: POST /auth/logout — Log Out (with proxy path aliases)
    if (
      (pathname === "/auth/logout" ||
        pathname === "/Operator/auth/logout" ||
        pathname === "/api/v1/operator/auth/logout") &&
      req.method === "POST"
    ) {
      const session = this.extractSessionFromRequest(req);
      if (session) {
        this.revokeSession(session.sessionId);
      }
      this.clearSessionCookie(res, req);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 1. API Route: POST /api/v1/operator/chat
    if (pathname === "/api/v1/operator/chat" && req.method === "POST") {
      // Early Content-Length check
      const contentLengthHeader = req.headers["content-length"];
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > this.maxBodySizeBytes) {
          res.writeHead(413, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error:
                "Payload Too Large: Request body exceeds maximum allowed size.",
            }),
          );
          return;
        }
      }

      // Streaming request body accumulation with size enforcement
      let bodyStr = "";
      let accumulatedBytes = 0;
      let bodyExceeded = false;

      try {
        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk: Buffer) => {
            if (bodyExceeded) return;
            accumulatedBytes += chunk.length;
            if (accumulatedBytes > this.maxBodySizeBytes) {
              bodyExceeded = true;
              req.destroy(); // Stop receiving data
              reject(new Error("PAYLOAD_TOO_LARGE"));
              return;
            }
            bodyStr += chunk.toString("utf-8");
          });

          req.on("end", () => {
            if (!bodyExceeded) resolve();
          });

          req.on("error", (err) => {
            reject(err);
          });
        });
      } catch (err: any) {
        if (err.message === "PAYLOAD_TOO_LARGE" || bodyExceeded) {
          if (!res.headersSent) {
            res.writeHead(413, {
              "Content-Type": "application/json; charset=utf-8",
              Connection: "close",
            });
            res.end(
              JSON.stringify({
                success: false,
                error:
                  "Payload Too Large: Request body exceeds maximum allowed size.",
              }),
            );
          }
          return;
        }
        if (!res.headersSent) {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error: "Bad Request: Unable to read request stream.",
            }),
          );
        }
        return;
      }

      let body: any = {};
      if (bodyStr) {
        try {
          body = JSON.parse(bodyStr);
        } catch (jsonErr: any) {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error: `Bad Request: Invalid JSON payload.`,
            }),
          );
          return;
        }
      }

      // Extract authorization header or active session cookie
      let authHeader = req.headers.authorization;
      const session = this.extractSessionFromRequest(req);
      if (!authHeader && session) {
        authHeader = `Bearer ${session.sessionId}`;
      }

      const apiReq: OperatorApiRequest = {
        headers: {
          authorization: authHeader,
        },
        body,
      };

      const apiRes = await this.apiHandler.handleChatRequest(apiReq);
      const payloadBuf = Buffer.from(JSON.stringify(apiRes.body), "utf-8");

      if (!res.headersSent) {
        res.writeHead(apiRes.statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": payloadBuf.length.toString(),
          Connection: "close",
        });
        res.end(payloadBuf);
      }
      return;
    }

    // 2. Web Interface Route: GET /Operator or GET /
    if (
      (pathname === "/Operator" ||
        pathname === "/operator" ||
        pathname === "/") &&
      req.method === "GET"
    ) {
      this.serveStaticFile(res, "index.html");
      return;
    }

    // 3. Static Assets: GET /app.css, /app.js, etc.
    if (req.method === "GET") {
      this.serveStaticFile(res, pathname);
      return;
    }

    // 4. Not Found
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  }

  private serveStaticFile(
    res: http.ServerResponse,
    requestedPath: string,
  ): void {
    // Strict path traversal prevention
    const safeBasename = path.basename(requestedPath);
    const targetPath = path.join(this.publicDir, safeBasename);

    // Verify resolved path stays strictly within publicDir
    const resolvedPublicDir = path.resolve(this.publicDir);
    const resolvedTargetPath = path.resolve(targetPath);

    if (!resolvedTargetPath.startsWith(resolvedPublicDir)) {
      res.writeHead(403, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden: Path traversal blocked.",
        }),
      );
      return;
    }

    if (
      !fs.existsSync(resolvedTargetPath) ||
      fs.statSync(resolvedTargetPath).isDirectory()
    ) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(JSON.stringify({ success: false, error: "Not Found" }));
      return;
    }

    const ext = path.extname(resolvedTargetPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };

    const contentType = contentTypeMap[ext];
    if (!contentType) {
      res.writeHead(403, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden: Asset type not allowed.",
        }),
      );
      return;
    }

    const fileContent = fs.readFileSync(resolvedTargetPath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileContent.length.toString(),
      Connection: "close",
    });
    res.end(fileContent);
  }
}
