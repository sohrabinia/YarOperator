import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitOperationParams {
  action: "status" | "commit" | "push" | "checkout" | "diff" | "branch";
  message?: string;
  branch?: string;
  cwd?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface GitOperationResult {
  output: string;
  branch?: string;
  exitCode?: number;
}

export class GitTool implements Tool<GitOperationParams, GitOperationResult> {
  metadata: ToolMetadata = {
    id: "git_operate",
    name: "Git Workspace Tool",
    description:
      "Performs real workspace Git operations with strict policy and approval enforcement.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  async execute(
    params: GitOperationParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<GitOperationResult>> {
    const cwd = params.cwd || process.cwd();
    const timeout = params.timeoutMs || 15000;

    let gitArgs: string[] = [];
    switch (params.action) {
      case "status":
        gitArgs = ["status"];
        break;
      case "diff":
        gitArgs = ["diff"];
        break;
      case "branch":
        gitArgs = params.branch ? ["branch", params.branch] : ["branch"];
        break;
      case "checkout":
        if (!params.branch) {
          return {
            success: false,
            error: "Git checkout requires a valid branch parameter.",
          };
        }
        gitArgs = ["checkout", params.branch];
        break;
      case "commit":
        if (!params.message || params.message.trim().length === 0) {
          return {
            success: false,
            error: "Git commit requires a non-empty commit message.",
          };
        }
        gitArgs = ["commit", "-m", params.message];
        break;
      case "push":
        gitArgs = params.branch ? ["push", "origin", params.branch] : ["push"];
        break;
      default:
        return {
          success: false,
          error: `Unsupported Git action: '${(params as any).action}'`,
        };
    }

    try {
      const { stdout, stderr } = await execFileAsync("git", gitArgs, {
        cwd,
        timeout,
      });

      let currentBranch = params.branch;
      if (!currentBranch) {
        try {
          const { stdout: branchOut } = await execFileAsync(
            "git",
            ["rev-parse", "--abbrev-ref", "HEAD"],
            { cwd, timeout: 5000 },
          );
          currentBranch = branchOut.trim();
        } catch {
          currentBranch = "main";
        }
      }

      return {
        success: true,
        output: {
          output: this.redactSecrets(
            stdout || stderr || "Git operation completed successfully.",
          ),
          branch: currentBranch,
          exitCode: 0,
        },
      };
    } catch (error: any) {
      const stdout = error.stdout
        ? this.redactSecrets(error.stdout.toString())
        : "";
      const stderr = error.stderr
        ? this.redactSecrets(error.stderr.toString())
        : "";
      const exitCode = typeof error.code === "number" ? error.code : 1;
      const isTimeout = error.killed || error.signal === "SIGTERM";

      return {
        success: false,
        error: isTimeout
          ? `Git command timed out after ${timeout}ms`
          : `Git ${params.action} failed with exit code ${exitCode}: ${stderr || stdout || error.message}`,
        output: {
          output: stderr || stdout || error.message,
          branch: params.branch,
          exitCode,
        },
      };
    }
  }

  private redactSecrets(text: string): string {
    if (!text) return "";
    return text.replace(
      this.sensitiveKeyPattern,
      (_match, key) => `${key}=[REDACTED]`,
    );
  }
}

export interface GitHubPRParams {
  action: "create_pr" | "merge_pr" | "get_pr";
  title?: string;
  body?: string;
  prNumber?: number;
  head?: string;
  base?: string;
  owner?: string;
  repo?: string;
  token?: string;
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
      "Interacts with GitHub API for real PR management under approval rules.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  async execute(
    params: GitHubPRParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<GitHubPRResult>> {
    const token =
      params.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (!token) {
      return {
        success: false,
        error:
          "NOT_CONFIGURED: GitHub credentials (GITHUB_TOKEN) are missing in current production environment.",
      };
    }

    const owner = params.owner || process.env.GITHUB_OWNER || "sohrabinia";
    const repo = params.repo || process.env.GITHUB_REPO || "YarOperator";

    try {
      if (params.action === "create_pr") {
        if (!params.title || !params.head) {
          return {
            success: false,
            error: "GitHub create_pr requires title and head branch.",
          };
        }

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
              "User-Agent": "YarOperator",
            },
            body: JSON.stringify({
              title: params.title,
              body: params.body || "",
              head: params.head,
              base: params.base || "main",
            }),
          },
        );

        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            error: `GitHub API error (${res.status}): ${errText}`,
          };
        }

        const data = (await res.json()) as any;
        return {
          success: true,
          output: {
            prNumber: data.number,
            url: data.html_url,
            status: data.state || "OPEN",
          },
        };
      }

      if (params.action === "get_pr") {
        if (!params.prNumber) {
          return {
            success: false,
            error: "GitHub get_pr requires prNumber parameter.",
          };
        }

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "YarOperator",
            },
          },
        );

        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            error: `GitHub API error (${res.status}): ${errText}`,
          };
        }

        const data = (await res.json()) as any;
        return {
          success: true,
          output: {
            prNumber: data.number,
            url: data.html_url,
            status: data.state || "OPEN",
          },
        };
      }

      if (params.action === "merge_pr") {
        if (!params.prNumber) {
          return {
            success: false,
            error: "GitHub merge_pr requires prNumber parameter.",
          };
        }

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${params.prNumber}/merge`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "YarOperator",
            },
          },
        );

        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            error: `GitHub API error (${res.status}): ${errText}`,
          };
        }

        const data = (await res.json()) as any;
        return {
          success: true,
          output: {
            prNumber: params.prNumber,
            url: `https://github.com/${owner}/${repo}/pull/${params.prNumber}`,
            status: data.merged ? "MERGED" : "FAILED",
          },
        };
      }

      return {
        success: false,
        error: `Unsupported GitHub action: '${params.action}'`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `GitHub API request failed: ${err.message}`,
      };
    }
  }
}

export interface JulesWorkerParams {
  prompt: string;
  taskType: "code_generation" | "review" | "analysis";
  apiKey?: string;
  apiUrl?: string;
}

export interface JulesWorkerResult {
  response: string;
  sanitized: boolean;
  warnings?: string[];
}

export type JulesWorkerProvider = (
  params: JulesWorkerParams,
) => Promise<string>;

export class JulesWorkerAdapter implements Tool<
  JulesWorkerParams,
  JulesWorkerResult
> {
  metadata: ToolMetadata = {
    id: "jules_worker_delegate",
    name: "Jules AI Worker Adapter",
    description:
      "Delegates sub-tasks to real Jules AI worker treating all outputs as UNTRUSTED DATA.",
    safetyLevel: "SAFE",
  };

  private untrustedPatterns = [
    /sudo/i,
    /chmod 777/i,
    /eval\(/i,
    /process\.exit/i,
  ];

  constructor(private workerProvider?: JulesWorkerProvider) {}

  async execute(
    params: JulesWorkerParams,
    _context: ExecutionContext,
  ): Promise<ToolResult<JulesWorkerResult>> {
    const apiKey = params.apiKey || process.env.JULES_API_KEY;
    const apiUrl = params.apiUrl || process.env.JULES_API_URL;

    if (!this.workerProvider && (!apiKey || !apiUrl)) {
      return {
        success: false,
        error:
          "NOT_CONFIGURED: Jules API key or worker endpoint is missing in current production environment.",
      };
    }

    try {
      let rawResponse = "";
      if (this.workerProvider) {
        rawResponse = await this.workerProvider(params);
      } else {
        const res = await fetch(apiUrl!, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        });

        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            error: `Jules API error (${res.status}): ${errText}`,
          };
        }

        const data = (await res.json()) as any;
        rawResponse = data.response || JSON.stringify(data);
      }

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
    } catch (err: any) {
      return {
        success: false,
        error: `Jules worker request failed: ${err.message}`,
      };
    }
  }
}
