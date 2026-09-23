import {
  OwnerCommandReceiver,
  OwnerCommandInput,
  OwnerCommandResult,
} from "../core/owner/index.js";
import { ExecutionContext } from "../core/contracts/index.js";
import { IdentityStore } from "../core/identity/index.js";

export interface OperatorApiRequest {
  headers: {
    authorization?: string;
  };
  body: {
    commandId?: string;
    ownerId?: string;
    workspaceId?: string;
    environmentId?: string;
    rawCommandText?: string;
    targetCapability?: string;
    requestedToolId?: string;
    params?: Record<string, unknown>;
  };
}

export interface OperatorApiResponse {
  statusCode: number;
  body: {
    success: boolean;
    error?: string;
    result?: {
      commandId: string;
      accepted: boolean;
      status:
        | "SAFE"
        | "EXECUTING"
        | "APPROVAL_REQUIRED"
        | "BLOCKED"
        | "COMPLETED"
        | "FAILED";
      preservedCommandText: string;
      resolvedCapability?: string;
      resolvedToolId?: string;
      auditEventId?: string;
      details?: unknown;
    };
    health?: {
      status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
      uptimeMs: number;
      timestamp: string;
    };
    readiness?: {
      status: "READY" | "NOT_READY";
      subsystems: {
        commandReceiver: boolean;
        identityStore: boolean;
      };
      timestamp: string;
    };
  };
}

export class OperatorApiHandler {
  private identityStore: IdentityStore;

  constructor(
    private commandReceiver: OwnerCommandReceiver,
    initialTokens?: Record<string, string>,
    identityStore?: IdentityStore,
  ) {
    if (!identityStore) {
      throw new Error(
        "AUTHENTICATION SECURITY FAILURE: IdentityStore must be provided to OperatorApiHandler.",
      );
    }
    this.identityStore = identityStore;
    if (initialTokens) {
      for (const [token, ownerId] of Object.entries(initialTokens)) {
        this.registerBearerToken(token, ownerId);
      }
    }
  }

  public getIdentityStore(): IdentityStore {
    return this.identityStore;
  }

  public getHealth(): OperatorApiResponse {
    return {
      statusCode: 200,
      body: {
        success: true,
        health: {
          status: "HEALTHY",
          uptimeMs: Math.floor(process.uptime() * 1000),
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  public getReadiness(): OperatorApiResponse {
    const commandReceiverReady = Boolean(this.commandReceiver);
    let identityStoreReady = true;

    if (this.identityStore) {
      try {
        identityStoreReady = this.identityStore.checkIntegrity();
      } catch (err) {
        identityStoreReady = false;
      }
    }

    const isReady = commandReceiverReady && identityStoreReady;

    return {
      statusCode: isReady ? 200 : 503,
      body: {
        success: isReady,
        readiness: {
          status: isReady ? "READY" : "NOT_READY",
          subsystems: {
            commandReceiver: commandReceiverReady,
            identityStore: identityStoreReady,
          },
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  public registerBearerToken(
    token: string,
    ownerId: string,
    defaultWorkspaces: string[] = ["yartrader", "ws_default"],
  ): void {
    if (!this.identityStore) {
      throw new Error(
        "AUTHENTICATION SECURITY FAILURE: Cannot register bearer token without an authoritative IdentityStore.",
      );
    }

    let user = this.identityStore.getUserById(ownerId);
    if (!user) {
      user =
        this.identityStore.getUserByEmail(`${ownerId}@yartrader.local`) ||
        this.identityStore.createUser({
          userId: ownerId,
          primaryEmail: `${ownerId}@yartrader.local`,
        });
    }
    for (const wsId of defaultWorkspaces) {
      if (!this.identityStore.isUserActiveWorkspaceMember(user.userId, wsId)) {
        this.identityStore.createWorkspace({
          workspaceId: wsId,
          name: `Workspace ${wsId}`,
          ownerUserId: user.userId,
        });
      }
    }
    const existingSession = this.identityStore.getSession(token);
    if (!existingSession) {
      this.identityStore.createSession({
        sessionId: token,
        userId: user.userId,
        ownerId,
      });
    }
  }

  public getAuthenticatedOwnerId(
    token: string,
    workspaceId?: string,
  ): { ownerId: string | null; error?: string } {
    if (!this.identityStore) {
      return {
        ownerId: null,
        error:
          "Unauthorized: IdentityStore unavailable (fail-closed bearer authentication).",
      };
    }

    const session = this.identityStore.getSession(token);
    if (!session) {
      return {
        ownerId: null,
        error: "Unauthorized: Invalid or expired Bearer token.",
      };
    }

    // Check UserIdentity status
    const user = this.identityStore.getUserById(session.userId);
    if (!user || user.status !== "ACTIVE") {
      return {
        ownerId: null,
        error: `Unauthorized: User identity '${session.userId}' is disabled or non-existent.`,
      };
    }

    // Check Workspace Membership if workspaceId is provided
    if (
      workspaceId &&
      !this.identityStore.isUserActiveWorkspaceMember(
        session.userId,
        workspaceId,
      )
    ) {
      return {
        ownerId: null,
        error: `Forbidden: User '${session.userId}' is not an active member of workspace '${workspaceId}'.`,
      };
    }

    return { ownerId: session.ownerId };
  }

  public async handleChatRequest(
    req: OperatorApiRequest,
    context?: ExecutionContext,
  ): Promise<OperatorApiResponse> {
    try {
      // 1. Authenticate Request via Bearer Token
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return {
          statusCode: 401,
          body: {
            success: false,
            error: "Unauthorized: Missing or invalid Bearer token format.",
          },
        };
      }

      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) {
        return {
          statusCode: 401,
          body: {
            success: false,
            error: "Unauthorized: Empty Bearer token provided.",
          },
        };
      }

      // 2. HTTP Input Validation
      const rawBody = req.body;
      if (
        !rawBody ||
        typeof rawBody !== "object" ||
        Array.isArray(rawBody) ||
        rawBody === null
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error: "Bad Request: Request body must be a JSON object.",
          },
        };
      }

      // Single Authoritative Auth Path: Token -> Session -> Active User -> Workspace Membership
      const authResult = this.getAuthenticatedOwnerId(
        token,
        rawBody.workspaceId,
      );
      if (!authResult.ownerId) {
        const isForbidden = authResult.error?.startsWith("Forbidden:");
        return {
          statusCode: isForbidden ? 403 : 401,
          body: {
            success: false,
            error: authResult.error || "Unauthorized: Authentication failed.",
          },
        };
      }

      const authenticatedOwnerId = authResult.ownerId;

      const {
        commandId = `cmd_api_${Date.now()}`,
        ownerId = authenticatedOwnerId,
        workspaceId,
        environmentId,
        rawCommandText,
        targetCapability,
        requestedToolId,
        params,
      } = rawBody;

      const effectiveOwnerId = ownerId;

      // Type & Length Validation Gates
      if (
        commandId &&
        (typeof commandId !== "string" || commandId.length > 256)
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: commandId must be a string up to 256 characters.",
          },
        };
      }

      if (ownerId && (typeof ownerId !== "string" || ownerId.length > 256)) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: ownerId must be a string up to 256 characters.",
          },
        };
      }

      // Prevent Owner Impersonation
      if (effectiveOwnerId !== authenticatedOwnerId) {
        return {
          statusCode: 403,
          body: {
            success: false,
            error: `Forbidden: Authenticated owner '${authenticatedOwnerId}' cannot submit commands as owner '${effectiveOwnerId}'.`,
          },
        };
      }

      if (
        !workspaceId ||
        typeof workspaceId !== "string" ||
        workspaceId.trim().length === 0 ||
        workspaceId.length > 256
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: workspaceId is required and must be a string up to 256 characters.",
          },
        };
      }

      if (
        environmentId &&
        (typeof environmentId !== "string" || environmentId.length > 256)
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: environmentId must be a string up to 256 characters.",
          },
        };
      }

      if (
        !rawCommandText ||
        typeof rawCommandText !== "string" ||
        rawCommandText.trim().length === 0
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: rawCommandText is required and must be a non-empty string.",
          },
        };
      }

      if (rawCommandText.length > 10000) {
        // Max command text length 10k chars
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: rawCommandText exceeds maximum length of 10000 characters.",
          },
        };
      }

      if (
        targetCapability &&
        (typeof targetCapability !== "string" || targetCapability.length > 256)
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: targetCapability must be a string up to 256 characters.",
          },
        };
      }

      if (
        requestedToolId &&
        (typeof requestedToolId !== "string" || requestedToolId.length > 256)
      ) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              "Bad Request: requestedToolId must be a string up to 256 characters.",
          },
        };
      }

      if (params && (typeof params !== "object" || Array.isArray(params))) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error: "Bad Request: params must be an object.",
          },
        };
      }

      // 3. Dispatch Input Command to OwnerCommandReceiver
      const resolvedEnvironmentId = environmentId || `env_${workspaceId}`;

      const commandInput: OwnerCommandInput = {
        commandId,
        ownerId: authenticatedOwnerId,
        workspaceId,
        environmentId: resolvedEnvironmentId,
        rawCommandText,
        targetCapability,
        requestedToolId,
        params,
        timestamp: new Date().toISOString(),
      };

      const receiverResult: OwnerCommandResult =
        await this.commandReceiver.receiveCommand(commandInput, context);

      if (!receiverResult.accepted) {
        return {
          statusCode: 400,
          body: {
            success: false,
            error:
              receiverResult.reason || "Command rejected by intake boundary.",
          },
        };
      }

      // 4. Map Assistant Workflow Result to API Response Status Contract
      let status:
        | "SAFE"
        | "EXECUTING"
        | "APPROVAL_REQUIRED"
        | "BLOCKED"
        | "COMPLETED"
        | "FAILED" = "SAFE";

      if (receiverResult.assistantResult) {
        const astRes = receiverResult.assistantResult;
        if (astRes.success) {
          status = "COMPLETED";
        } else {
          const stepStatus = astRes.executedSteps[0]?.status;
          if (stepStatus === "APPROVAL_REQUIRED") {
            status = "APPROVAL_REQUIRED";
          } else if (stepStatus === "BLOCKED") {
            status = "BLOCKED";
          } else {
            status = "FAILED";
          }
        }
      }

      return {
        statusCode: 200,
        body: {
          success: true,
          result: {
            commandId: receiverResult.commandId,
            accepted: true,
            status,
            preservedCommandText: receiverResult.commandTextPreserved,
            resolvedCapability: receiverResult.resolvedCapability,
            resolvedToolId: receiverResult.resolvedToolId,
            auditEventId: receiverResult.auditEventId,
            details: receiverResult.assistantResult,
          },
        },
      };
    } catch (err: any) {
      console.error("API HANDLER UNHANDLED ERROR:", err);
      return {
        statusCode: 500,
        body: {
          success: false,
          error: "Internal Server Error: Request processing failed.",
        },
      };
    }
  }
}
