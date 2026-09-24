import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AuditManager } from "../audit/index.js";

export interface RepositoryResourceConfig {
  repositoryId: string;
  workspaceId: string;
  root: string;
}

export interface EnvironmentResourceConfig {
  environmentId: string;
  name: string;
  type?: string;
}

export interface ServiceResourceConfig {
  serviceId: string;
  name?: string;
}

export interface HttpOriginResourceConfig {
  origin: string;
}

export interface WorkspaceResourceConfig {
  workspaceId: string;
  aliases?: string[];
  allowedRoots: string[];
  repositories?: RepositoryResourceConfig[];
  environments?: EnvironmentResourceConfig[];
  allowedServices?: (string | ServiceResourceConfig)[];
  allowedHttpOrigins?: (string | HttpOriginResourceConfig)[];
}

export interface ResourceRegistryConfig {
  defaultWorkspaceId?: string;
  workspaces: WorkspaceResourceConfig[];
}

export class ResourceRegistry {
  private config: ResourceRegistryConfig;
  private rawBytes?: Buffer;
  private loadedPath?: string;

  constructor(
    configInput?: ResourceRegistryConfig | string,
    options?: { skipFsCheck?: boolean },
  ) {
    if (typeof configInput === "string") {
      this.loadedPath = configInput;
      if (!fs.existsSync(configInput)) {
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Registry file '${configInput}' does not exist or is unreadable.`,
        );
      }
      try {
        this.rawBytes = fs.readFileSync(configInput);
        const cleanCwd = path.resolve(process.cwd()).replace(/\\/g, "\\\\");
        const interpolated = this.rawBytes
          .toString("utf-8")
          .replace(/\$\{CWD\}/g, cleanCwd);
        const parsed = JSON.parse(interpolated);
        this.config = parsed;
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Registry file '${configInput}' contains malformed JSON: ${err.message}`,
          );
        }
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Unreadable registry file '${configInput}': ${err.message}`,
        );
      }
    } else if (configInput) {
      const cleanCwd = path.resolve(process.cwd()).replace(/\\/g, "\\\\");
      const jsonStr = JSON.stringify(configInput).replace(
        /\$\{CWD\}/g,
        cleanCwd,
      );
      this.config = JSON.parse(jsonStr);
      this.rawBytes = Buffer.from(JSON.stringify(this.config), "utf-8");
      this.loadedPath = "in-memory";
    } else {
      const envPath = process.env.OPERATOR_RESOURCES_PATH;
      if (!envPath) {
        throw new Error(
          "RESOURCE REGISTRY FAILURE: Missing configuration source (OPERATOR_RESOURCES_PATH is not set).",
        );
      }
      this.loadedPath = envPath;
      if (!fs.existsSync(envPath)) {
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Registry file '${envPath}' does not exist or is unreadable.`,
        );
      }
      try {
        this.rawBytes = fs.readFileSync(envPath);
        const cleanCwd = path.resolve(process.cwd()).replace(/\\/g, "\\\\");
        const interpolated = this.rawBytes
          .toString("utf-8")
          .replace(/\$\{CWD\}/g, cleanCwd);
        this.config = JSON.parse(interpolated);
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Registry file '${envPath}' contains malformed JSON: ${err.message}`,
          );
        }
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Unreadable registry file '${envPath}': ${err.message}`,
        );
      }
    }

    this.validateAndFreeze(options?.skipFsCheck ?? false);
  }

  private validateAndFreeze(skipFsCheck: boolean): void {
    if (!this.config || typeof this.config !== "object") {
      throw new Error(
        "RESOURCE REGISTRY FAILURE: Configuration must be a non-null object.",
      );
    }

    if (!Array.isArray(this.config.workspaces)) {
      throw new Error(
        "RESOURCE REGISTRY FAILURE: Required field 'workspaces' array is missing or invalid.",
      );
    }

    if (this.config.workspaces.length === 0) {
      throw new Error(
        "RESOURCE REGISTRY FAILURE: Registry configuration contains zero workspaces.",
      );
    }

    const seenWorkspaceIds = new Set<string>();
    const seenAliases = new Map<string, string>(); // alias -> workspaceId

    for (const ws of this.config.workspaces) {
      if (
        !ws.workspaceId ||
        typeof ws.workspaceId !== "string" ||
        !ws.workspaceId.trim()
      ) {
        throw new Error(
          "RESOURCE REGISTRY FAILURE: Workspace entry missing required string field 'workspaceId'.",
        );
      }

      const wsId = ws.workspaceId.trim();
      if (seenWorkspaceIds.has(wsId)) {
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Duplicate workspaceId '${wsId}' detected in configuration.`,
        );
      }
      seenWorkspaceIds.add(wsId);

      if (ws.aliases) {
        if (!Array.isArray(ws.aliases)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Aliases for workspace '${wsId}' must be an array of strings.`,
          );
        }
        for (const alias of ws.aliases) {
          if (!alias || typeof alias !== "string" || !alias.trim()) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Invalid empty alias string in workspace '${wsId}'.`,
            );
          }
          const cleanAlias = alias.trim();
          if (seenWorkspaceIds.has(cleanAlias)) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Alias '${cleanAlias}' in workspace '${wsId}' conflicts with existing workspaceId '${cleanAlias}'.`,
            );
          }
          if (seenAliases.has(cleanAlias)) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Duplicate alias '${cleanAlias}' detected in workspace '${wsId}' (already used by '${seenAliases.get(cleanAlias)}').`,
            );
          }
          seenAliases.set(cleanAlias, wsId);
        }
      }

      if (!Array.isArray(ws.allowedRoots) || ws.allowedRoots.length === 0) {
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Workspace '${wsId}' must define a non-empty 'allowedRoots' array.`,
        );
      }

      const resolvedAllowedRoots: string[] = [];
      for (const rootPath of ws.allowedRoots) {
        if (!rootPath || typeof rootPath !== "string" || !rootPath.trim()) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Workspace '${wsId}' contains invalid empty allowed root path.`,
          );
        }

        // Must be absolute path
        const isWinAbs =
          /^[a-zA-Z]:[\\/]/.test(rootPath) || rootPath.startsWith("\\\\");
        const isPosixAbs = rootPath.startsWith("/");
        if (!isWinAbs && !isPosixAbs && !path.isAbsolute(rootPath)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Workspace '${wsId}' allowed root '${rootPath}' is relative. Allowed roots MUST be absolute paths.`,
          );
        }

        if (!skipFsCheck) {
          try {
            if (!fs.existsSync(rootPath)) {
              throw new Error(
                `RESOURCE REGISTRY FAILURE: Workspace '${wsId}' allowed root path '${rootPath}' cannot be resolved on filesystem.`,
              );
            }
          } catch (err: any) {
            if (err.message.startsWith("RESOURCE REGISTRY FAILURE:")) throw err;
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Workspace '${wsId}' allowed root path '${rootPath}' cannot be resolved: ${err.message}`,
            );
          }
        }

        resolvedAllowedRoots.push(path.normalize(rootPath));
      }

      if (ws.repositories) {
        if (!Array.isArray(ws.repositories)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Repositories for workspace '${wsId}' must be an array.`,
          );
        }

        for (const repo of ws.repositories) {
          if (
            !repo.repositoryId ||
            typeof repo.repositoryId !== "string" ||
            !repo.repositoryId.trim()
          ) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Repository in workspace '${wsId}' missing required 'repositoryId'.`,
            );
          }

          if (repo.workspaceId !== wsId) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Repository '${repo.repositoryId}' in workspace '${wsId}' is bound to wrong workspaceId '${repo.workspaceId}'.`,
            );
          }

          if (
            !repo.root ||
            typeof repo.root !== "string" ||
            !repo.root.trim()
          ) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Repository '${repo.repositoryId}' in workspace '${wsId}' missing required 'root'.`,
            );
          }

          const isWinAbs =
            /^[a-zA-Z]:[\\/]/.test(repo.root) || repo.root.startsWith("\\\\");
          const isPosixAbs = repo.root.startsWith("/");
          if (!isWinAbs && !isPosixAbs && !path.isAbsolute(repo.root)) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Repository '${repo.repositoryId}' root path '${repo.root}' is relative. Repository roots MUST be absolute paths.`,
            );
          }

          if (!skipFsCheck) {
            if (!fs.existsSync(repo.root)) {
              throw new Error(
                `RESOURCE REGISTRY FAILURE: Repository '${repo.repositoryId}' root path '${repo.root}' cannot be resolved on filesystem.`,
              );
            }
          }

          const normRepoRoot = path.normalize(repo.root);
          const isInsideAllowedRoot = resolvedAllowedRoots.some(
            (allowedRoot) => {
              const rel = path.relative(allowedRoot, normRepoRoot);
              return !rel.startsWith("..") && !path.isAbsolute(rel);
            },
          );

          if (!isInsideAllowedRoot) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Repository '${repo.repositoryId}' root '${repo.root}' lies outside workspace '${wsId}' allowed roots [${resolvedAllowedRoots.join(", ")}].`,
            );
          }
        }
      }

      if (ws.environments) {
        if (!Array.isArray(ws.environments)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Environments in workspace '${wsId}' must be an array.`,
          );
        }
        for (const env of ws.environments) {
          if (
            !env.environmentId ||
            typeof env.environmentId !== "string" ||
            !env.environmentId.trim()
          ) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Environment entry in workspace '${wsId}' missing 'environmentId'.`,
            );
          }
        }
      }

      if (ws.allowedServices) {
        if (!Array.isArray(ws.allowedServices)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Allowed services in workspace '${wsId}' must be an array.`,
          );
        }
        for (const service of ws.allowedServices) {
          if (typeof service === "string") {
            if (!service.trim()) {
              throw new Error(
                `RESOURCE REGISTRY FAILURE: Empty service entry in workspace '${wsId}'.`,
              );
            }
          } else if (typeof service === "object" && service !== null) {
            if (
              !service.serviceId ||
              typeof service.serviceId !== "string" ||
              !service.serviceId.trim()
            ) {
              throw new Error(
                `RESOURCE REGISTRY FAILURE: Service object in workspace '${wsId}' missing required 'serviceId'.`,
              );
            }
          } else {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Invalid service entry in workspace '${wsId}'.`,
            );
          }
        }
      }

      if (ws.allowedHttpOrigins) {
        if (!Array.isArray(ws.allowedHttpOrigins)) {
          throw new Error(
            `RESOURCE REGISTRY FAILURE: Allowed HTTP origins in workspace '${wsId}' must be an array.`,
          );
        }
        for (const originEntry of ws.allowedHttpOrigins) {
          const originStr =
            typeof originEntry === "string" ? originEntry : originEntry?.origin;
          if (
            !originStr ||
            typeof originStr !== "string" ||
            !originStr.trim()
          ) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: Invalid HTTP origin entry in workspace '${wsId}'.`,
            );
          }
          if (
            !originStr.startsWith("http://") &&
            !originStr.startsWith("https://") &&
            originStr !== "*"
          ) {
            throw new Error(
              `RESOURCE REGISTRY FAILURE: HTTP origin '${originStr}' in workspace '${wsId}' must start with http:// or https:// or be '*'.`,
            );
          }
        }
      }
    }

    if (this.config.defaultWorkspaceId) {
      const defId = this.config.defaultWorkspaceId.trim();
      const resolvedDef = seenWorkspaceIds.has(defId)
        ? defId
        : seenAliases.get(defId);
      if (!resolvedDef) {
        throw new Error(
          `RESOURCE REGISTRY FAILURE: Configured defaultWorkspaceId '${defId}' does not exist in registry workspaces or aliases.`,
        );
      }
    }

    // Freeze configuration recursively to enforce post-bootstrap immutability
    this.deepFreeze(this.config);
  }

  private deepFreeze<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") return obj;
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
      const val = (obj as any)[key];
      if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
        this.deepFreeze(val);
      }
    }
    return obj;
  }

  public getRawBytes(): Buffer {
    return this.rawBytes || Buffer.from(JSON.stringify(this.config), "utf-8");
  }

  public getLoadedPath(): string {
    return this.loadedPath || "in-memory";
  }

  public getDefaultWorkspaceId(): string | undefined {
    return this.config.defaultWorkspaceId;
  }

  public getWorkspace(
    workspaceIdOrAlias: string,
  ): WorkspaceResourceConfig | undefined {
    if (!workspaceIdOrAlias) return undefined;
    const target = workspaceIdOrAlias.trim();
    for (const ws of this.config.workspaces) {
      if (ws.workspaceId === target) return ws;
      if (ws.aliases && ws.aliases.includes(target)) return ws;
    }
    return undefined;
  }

  public listWorkspaces(): WorkspaceResourceConfig[] {
    return [...this.config.workspaces];
  }

  public calculateSha256(): string {
    return createHash("sha256").update(this.getRawBytes()).digest("hex");
  }

  public async auditBootstrap(auditManager?: AuditManager): Promise<string> {
    const hash = this.calculateSha256();
    const workspaceIds = this.config.workspaces.map((w) => w.workspaceId);
    const environmentIds: string[] = [];
    for (const ws of this.config.workspaces) {
      if (ws.environments) {
        for (const env of ws.environments) {
          environmentIds.push(env.environmentId);
        }
      }
    }

    if (auditManager) {
      await auditManager.recordEvent(
        "REGISTRY_BOOTSTRAP_SUCCESS",
        {
          configPathIdentifier: this.getLoadedPath(),
          sha256: hash,
          workspaceIds,
          environmentIds,
          defaultWorkspaceId: this.config.defaultWorkspaceId || null,
        },
        { severity: "LOW" },
      );
    }

    return hash;
  }
}
