import {
  OwnerCommandReceiver,
  OwnerCommandInput,
  OwnerCommandResult,
} from "../core/owner/index.js";
import { ExecutionContext } from "../core/contracts/index.js";

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
  };
}

export class OperatorApiHandler {
  private validBearerTokens: Map<string, string> = new Map(); // token -> ownerId

  constructor(
    private commandReceiver: OwnerCommandReceiver,
    initialTokens?: Record<string, string>,
  ) {
    if (initialTokens) {
      for (const [token, ownerId] of Object.entries(initialTokens)) {
        this.validBearerTokens.set(token, ownerId);
      }
    }
  }

  public registerBearerToken(token: string, ownerId: string): void {
    this.validBearerTokens.set(token, ownerId);
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

      const authenticatedOwnerId = this.validBearerTokens.get(token);

      if (!authenticatedOwnerId) {
        return {
          statusCode: 401,
          body: {
            success: false,
            error: "Unauthorized: Invalid or expired Bearer token.",
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
      if (ownerId !== authenticatedOwnerId) {
        return {
          statusCode: 403,
          body: {
            success: false,
            error: `Forbidden: Authenticated owner '${authenticatedOwnerId}' cannot submit commands as owner '${ownerId}'.`,
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
      const commandInput: OwnerCommandInput = {
        commandId,
        ownerId: authenticatedOwnerId,
        workspaceId,
        environmentId,
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
