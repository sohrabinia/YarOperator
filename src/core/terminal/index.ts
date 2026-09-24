import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { ResourceRegistry } from "../registry/resource.js";
import {
  ResourceResolver,
  ResolvedResource,
  isResolvedResource,
} from "../registry/resolver.js";

const execFileAsync = promisify(execFile);

export interface TerminalParams {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface TerminalOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TerminalTool implements Tool<TerminalParams, TerminalOutput> {
  metadata: ToolMetadata = {
    id: "terminal_execute",
    name: "Terminal Command Execution",
    description:
      "Executes controlled terminal commands with process isolation, timeout, and secret redaction.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  resolveCanonicalAction(_params: TerminalParams): string {
    return "terminal_execute:run";
  }

  private blockedCommands = ["rm", "mkfs", "dd", "shutdown", "reboot"];
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  constructor(private resourceResolver?: ResourceResolver) {}

  public setResourceResolver(resolver: ResourceResolver): void {
    this.resourceResolver = resolver;
  }

  async execute(
    params: TerminalParams,
    context: ExecutionContext,
  ): Promise<ToolResult<TerminalOutput>> {
    const resolver =
      (context.metadata?.resourceResolver as ResourceResolver) ||
      this.resourceResolver;

    if (!resolver) {
      return {
        success: false,
        error:
          "RESOURCE RESOLUTION FAILURE: ResourceResolver is required for TerminalTool execution.",
      };
    }

    const wsId = context.workspaceId;
    if (!wsId) {
      return {
        success: false,
        error:
          "RESOURCE RESOLUTION FAILURE: workspaceId is required in ExecutionContext for TerminalTool.",
      };
    }

    let resolvedResource: ResolvedResource;

    if (
      context.metadata?.resolvedResource &&
      isResolvedResource(context.metadata.resolvedResource)
    ) {
      resolvedResource = context.metadata.resolvedResource as ResolvedResource;
      if (resolvedResource.workspaceId !== wsId) {
        return {
          success: false,
          error: `Terminal execution rejected: Pre-resolved resource workspace '${resolvedResource.workspaceId}' does not match context workspace '${wsId}'.`,
        };
      }
    } else {
      const targetPath = params.cwd || ".";
      const res = resolver.resolveResource(wsId, targetPath);
      if (!res.success) {
        return {
          success: false,
          error: `Terminal execution rejected: ${res.error}`,
        };
      }
      resolvedResource = res.resource;
    }

    const targetCwd = resolvedResource.canonicalPath;
    const cmd = (params.command || "").trim();
    if (!cmd) {
      return {
        success: false,
        error: "Terminal command cannot be empty.",
      };
    }

    for (const blocked of this.blockedCommands) {
      if (cmd === blocked || cmd.endsWith(`/${blocked}`)) {
        return {
          success: false,
          error: `Blocked unsafe terminal executable: '${blocked}'`,
        };
      }
    }

    const args = params.args || [];
    const timeout = params.timeoutMs || 10000;

    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: targetCwd,
        timeout,
        shell: false,
        env: { ...process.env, ...params.env },
      });

      return {
        success: true,
        output: {
          stdout: this.redactSecrets(stdout),
          stderr: this.redactSecrets(stderr),
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
          ? `Command timed out after ${timeout}ms`
          : `Command failed with exit code ${exitCode}: ${stderr || stdout || error.message}`,
        output: {
          stdout,
          stderr,
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
