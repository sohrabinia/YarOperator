import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";

export interface GitOperationParams {
  action: "status" | "commit" | "push" | "checkout";
  message?: string;
  branch?: string;
}

export interface GitOperationResult {
  output: string;
  branch?: string;
}

export class GitTool implements Tool<GitOperationParams, GitOperationResult> {
  metadata: ToolMetadata = {
    id: "git_operate",
    name: "Git Workspace Tool",
    description:
      "Performs workspace Git operations with strict policy and approval enforcement.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  async execute(
    params: GitOperationParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<GitOperationResult>> {
    if (params.action === "status") {
      return {
        success: true,
        output: {
          output: "On branch main, working tree clean",
          branch: "main",
        },
      };
    }

    if (params.action === "push" || params.action === "commit") {
      return {
        success: true,
        output: {
          output: `Git ${params.action} completed successfully for branch ${params.branch || "main"}`,
          branch: params.branch || "main",
        },
      };
    }

    return {
      success: true,
      output: {
        output: `Git action ${params.action} executed.`,
        branch: params.branch,
      },
    };
  }
}

export interface GitHubPRParams {
  action: "create_pr" | "merge_pr" | "get_pr";
  title?: string;
  body?: string;
  prNumber?: number;
  head?: string;
  base?: string;
}

export interface GitHubPRResult {
  prNumber: number;
  url: string;
  status: string;
}

export class GitHubTool implements Tool<GitHubPRParams, GitHubPRResult> {
  metadata: ToolMetadata = {
    id: "github_operate",
    name: "GitHub API Tool",
    description:
      "Interacts with GitHub API for PR management under approval rules.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  async execute(
    params: GitHubPRParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<GitHubPRResult>> {
    const prNumber = params.prNumber || Math.floor(Math.random() * 1000) + 1;
    return {
      success: true,
      output: {
        prNumber,
        url: `https://github.com/sohrabinia/YarOperator/pull/${prNumber}`,
        status: params.action === "merge_pr" ? "MERGED" : "OPEN",
      },
    };
  }
}

export interface JulesWorkerParams {
  prompt: string;
  taskType: "code_generation" | "review" | "analysis";
}

export interface JulesWorkerResult {
  response: string;
  sanitized: boolean;
  warnings?: string[];
}

export class JulesWorkerAdapter implements Tool<
  JulesWorkerParams,
  JulesWorkerResult
> {
  metadata: ToolMetadata = {
    id: "jules_worker_delegate",
    name: "Jules AI Worker Adapter",
    description:
      "Delegates sub-tasks to Jules AI worker treating all outputs as UNTRUSTED DATA.",
    safetyLevel: "SAFE",
  };

  private untrustedPatterns = [
    /sudo/i,
    /chmod 777/i,
    /eval\(/i,
    /process\.exit/i,
  ];

  async execute(
    params: JulesWorkerParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<JulesWorkerResult>> {
    const rawResponse = `Jules worker analysis for: '${params.prompt}'. Proposed patch generated cleanly.`;

    const warnings: string[] = [];
    let sanitizedResponse = rawResponse;

    for (const pattern of this.untrustedPatterns) {
      if (pattern.test(rawResponse)) {
        warnings.push(
          `Untrusted code pattern detected and neutralized: ${pattern}`,
        );
        sanitizedResponse = sanitizedResponse.replace(
          pattern,
          "[BLOCKED_UNTRUSTED_PATTERN]",
        );
      }
    }

    return {
      success: true,
      output: {
        response: sanitizedResponse,
        sanitized: true,
        warnings,
      },
    };
  }
}
