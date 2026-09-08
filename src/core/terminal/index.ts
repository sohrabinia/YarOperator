import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
      "Executes controlled terminal shell commands with timeout, output normalization, and secret redaction.",
    safetyLevel: "APPROVAL_REQUIRED",
  };

  private blockedCommands = ["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:"];
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  async execute(
    params: TerminalParams,
    context: ExecutionContext,
  ): Promise<ToolResult<TerminalOutput>> {
    const fullCommand =
      params.args && params.args.length > 0
        ? `${params.command} ${params.args.join(" ")}`
        : params.command;

    for (const blocked of this.blockedCommands) {
      if (fullCommand.includes(blocked)) {
        return {
          success: false,
          error: `Blocked unsafe terminal command containing: '${blocked}'`,
        };
      }
    }

    const timeout = params.timeoutMs || 10000;

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd: params.cwd,
        timeout,
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
