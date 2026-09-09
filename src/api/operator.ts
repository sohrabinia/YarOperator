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
    // 1. Authenticate Request via Bearer Token
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        body: {
          success: false,
          error: "Unauthorized: Missing or invalid Bearer token.",
        },
      };
    }

    const token = authHeader.replace("Bearer ", "").trim();
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

    // 2. Validate Body Request Data
    const {
      commandId = `cmd_api_${Date.now()}`,
      ownerId = authenticatedOwnerId,
      workspaceId,
      environmentId,
      rawCommandText,
      targetCapability,
      requestedToolId,
      params,
    } = req.body || {};

    // Prevent Owner ID Impersonation
    if (ownerId !== authenticatedOwnerId) {
      return {
        statusCode: 403,
        body: {
          success: false,
          error: `Forbidden: Authenticated owner '${authenticatedOwnerId}' cannot submit commands as owner '${ownerId}'.`,
        },
      };
    }

    if (!workspaceId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: "Bad Request: workspaceId is required.",
        },
      };
    }

    if (!rawCommandText || rawCommandText.trim().length === 0) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: "Bad Request: rawCommandText is required.",
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
  }
}
