import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";

const require = createRequire(import.meta.url);

export interface UserIdentity {
  userId: string;
  primaryEmail: string;
  displayName?: string;
  status: "ACTIVE" | "DISABLED";
  defaultWorkspaceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderBinding {
  id: string;
  userId: string;
  provider: string;
  providerSub: string;
  emailAtBinding: string;
  createdAt: number;
}

export interface WorkspaceRecord {
  workspaceId: string;
  name: string;
  ownerUserId: string;
  createdAt: number;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "INACTIVE";
  createdAt: number;
}

export interface PersistentSession {
  sessionId: string;
  userId: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
}

export function generateUlid(): string {
  const time = Date.now();
  const timeHex = time.toString(36).padStart(8, "0").toUpperCase();
  const random = randomBytes(12).toString("hex").toUpperCase();
  return `usr_${timeHex}${random}`;
}

export class IdentityStore {
  private db: any;

  constructor(dbPath: string = "operator.db") {
    if (dbPath !== ":memory:") {
      const parentDir = dirname(dbPath);
      if (parentDir && parentDir !== ".") {
        mkdirSync(parentDir, { recursive: true });
      }
    }
    const { DatabaseSync } = require("node:sqlite");
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_identities (
        user_id TEXT PRIMARY KEY,
        primary_email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL,
        default_workspace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_provider_bindings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_sub TEXT NOT NULL,
        email_at_binding TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(provider, provider_sub),
        FOREIGN KEY(user_id) REFERENCES user_identities(user_id)
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(owner_user_id) REFERENCES user_identities(user_id)
      );

      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, user_id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(workspace_id),
        FOREIGN KEY(user_id) REFERENCES user_identities(user_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES user_identities(user_id)
      );
    `);
  }

  public createUser(params: {
    userId?: string;
    primaryEmail: string;
    displayName?: string;
    defaultWorkspaceId?: string;
  }): UserIdentity {
    const userId = params.userId || generateUlid();
    const now = Date.now();
    const email = params.primaryEmail.trim().toLowerCase();

    const stmt = this.db.prepare(`
      INSERT INTO user_identities (user_id, primary_email, display_name, status, default_workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)
    `);

    stmt.run(
      userId,
      email,
      params.displayName || null,
      params.defaultWorkspaceId || null,
      now,
      now,
    );

    return this.getUserById(userId)!;
  }

  public getUserById(userId: string): UserIdentity | null {
    const stmt = this.db.prepare(
      `SELECT * FROM user_identities WHERE user_id = ?`,
    );
    const row = stmt.get(userId) as any;
    if (!row) return null;

    return {
      userId: row.user_id,
      primaryEmail: row.primary_email,
      displayName: row.display_name || undefined,
      status: row.status as "ACTIVE" | "DISABLED",
      defaultWorkspaceId: row.default_workspace_id || undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public getUserByEmail(email: string): UserIdentity | null {
    const stmt = this.db.prepare(
      `SELECT * FROM user_identities WHERE primary_email = ?`,
    );
    const row = stmt.get(email.trim().toLowerCase()) as any;
    if (!row) return null;

    return {
      userId: row.user_id,
      primaryEmail: row.primary_email,
      displayName: row.display_name || undefined,
      status: row.status as "ACTIVE" | "DISABLED",
      defaultWorkspaceId: row.default_workspace_id || undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public bindProvider(params: {
    userId: string;
    provider: string;
    providerSub: string;
    emailAtBinding: string;
  }): ProviderBinding {
    const id = `bind_${randomBytes(16).toString("hex")}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO user_provider_bindings (id, user_id, provider, provider_sub, email_at_binding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.userId,
      params.provider,
      params.providerSub,
      params.emailAtBinding.trim().toLowerCase(),
      now,
    );

    return {
      id,
      userId: params.userId,
      provider: params.provider,
      providerSub: params.providerSub,
      emailAtBinding: params.emailAtBinding.trim().toLowerCase(),
      createdAt: now,
    };
  }

  public getUserByProviderSub(
    provider: string,
    providerSub: string,
  ): UserIdentity | null {
    const stmt = this.db.prepare(`
      SELECT u.* FROM user_identities u
      JOIN user_provider_bindings b ON u.user_id = b.user_id
      WHERE b.provider = ? AND b.provider_sub = ?
    `);
    const row = stmt.get(provider, providerSub) as any;
    if (!row) return null;

    return {
      userId: row.user_id,
      primaryEmail: row.primary_email,
      displayName: row.display_name || undefined,
      status: row.status as "ACTIVE" | "DISABLED",
      defaultWorkspaceId: row.default_workspace_id || undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public createWorkspace(params: {
    workspaceId: string;
    name: string;
    ownerUserId: string;
  }): WorkspaceRecord {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workspaces (workspace_id, name, owner_user_id, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(params.workspaceId, params.name, params.ownerUserId, now);

    this.addWorkspaceMembership({
      workspaceId: params.workspaceId,
      userId: params.ownerUserId,
      role: "OWNER",
      status: "ACTIVE",
    });

    return {
      workspaceId: params.workspaceId,
      name: params.name,
      ownerUserId: params.ownerUserId,
      createdAt: now,
    };
  }

  public addWorkspaceMembership(params: {
    workspaceId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    status?: "ACTIVE" | "INACTIVE";
  }): WorkspaceMembership {
    const now = Date.now();
    const status = params.status || "ACTIVE";

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workspace_memberships (workspace_id, user_id, role, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(params.workspaceId, params.userId, params.role, status, now);

    return {
      workspaceId: params.workspaceId,
      userId: params.userId,
      role: params.role,
      status,
      createdAt: now,
    };
  }

  public isUserActiveWorkspaceMember(
    userId: string,
    workspaceId: string,
  ): boolean {
    const stmt = this.db.prepare(`
      SELECT status FROM workspace_memberships
      WHERE workspace_id = ? AND user_id = ?
    `);
    const row = stmt.get(workspaceId, userId) as any;
    return Boolean(row && row.status === "ACTIVE");
  }

  public hashSessionToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  public createSession(params: {
    sessionId?: string;
    userId: string;
    ownerId: string;
    ttlMs?: number;
  }): PersistentSession {
    const rawSessionId =
      params.sessionId || `sess_${randomBytes(32).toString("hex")}`;
    const tokenHash = this.hashSessionToken(rawSessionId);
    const now = Date.now();
    const expiresAt = now + (params.ttlMs ?? 24 * 3600 * 1000);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (session_id, user_id, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(tokenHash, params.userId, params.ownerId, now, expiresAt);

    return {
      sessionId: rawSessionId,
      userId: params.userId,
      ownerId: params.ownerId,
      createdAt: now,
      expiresAt,
    };
  }

  public getSession(sessionId: string): PersistentSession | null {
    if (!sessionId) return null;
    const tokenHash = this.hashSessionToken(sessionId);

    const stmt = this.db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
    const row = stmt.get(tokenHash) as any;
    if (!row) return null;

    if (Date.now() > Number(row.expires_at)) {
      this.revokeSession(sessionId);
      return null;
    }

    return {
      sessionId,
      userId: row.user_id,
      ownerId: row.owner_id,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
    };
  }

  public revokeSession(sessionId: string): void {
    const tokenHash = this.hashSessionToken(sessionId);
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE session_id = ?`);
    stmt.run(tokenHash);
  }

  public migrateLegacyOwnerSohrab(
    legacyEmail: string = "m.a.sohrabinia@gmail.com",
    defaultWorkspaces: string[] = ["yartrader", "ws_default"],
  ): UserIdentity {
    let user = this.getUserByEmail(legacyEmail);
    if (!user) {
      user = this.createUser({
        primaryEmail: legacyEmail,
        displayName: "Sohrab (Migrated Owner)",
        defaultWorkspaceId: defaultWorkspaces[0],
      });
    }

    for (const wsId of defaultWorkspaces) {
      this.createWorkspace({
        workspaceId: wsId,
        name: `Workspace ${wsId}`,
        ownerUserId: user.userId,
      });
    }

    return user;
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
    }
  }
}
