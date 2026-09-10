import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { execFile } from "child_process";
import { promisify } from "util";

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

  private blockedCommands = ["rm", "mkfs", "dd", "shutdown", "reboot"];
  private sensitiveKeyPattern =
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|BEARER)[=:\s]+["']?([^\s"']+)["']?/gi;

  async execute(
    params: TerminalParams,
    context: ExecutionContext,
  ): Promise<ToolResult<TerminalOutput>> {
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
        cwd: params.cwd,
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
