import fs from "node:fs";
import path from "node:path";
import { ResourceRegistry, WorkspaceResourceConfig } from "./resource.js";
import { AuditManager } from "../audit/index.js";

const RESOLVED_RESOURCE_BRAND = Symbol("ResolvedResourceBrand");

export interface ResolvedResource {
  readonly [RESOLVED_RESOURCE_BRAND]: true;
  readonly workspaceId: string;
  readonly canonicalPath: string;
  readonly allowedRoot: string;
  readonly repositoryId?: string;
}

export function isResolvedResource(obj: unknown): obj is ResolvedResource {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as any)[RESOLVED_RESOURCE_BRAND] === true
  );
}

export interface ResourceResolutionError {
  success: false;
  error: string;
  code:
    | "UNKNOWN_WORKSPACE"
    | "PATH_TRAVERSAL"
    | "SIBLING_PREFIX_BYPASS"
    | "CROSS_WORKSPACE_ACCESS"
    | "SYMLINK_ESCAPE"
    | "JUNCTION_ESCAPE"
    | "UNAUTHORIZED_ROOT"
    | "INVALID_PATH"
    | "CASE_MISMATCH"
    | "UNC_BOUNDARY_DENIED"
    | "EIGHT_DOT_THREE_BYPASS"
    | "TRAILING_CHAR_BYPASS";
}

export interface ResourceResolutionSuccess {
  success: true;
  resource: ResolvedResource;
}

export type ResourceResolutionResult =
  ResourceResolutionSuccess | ResourceResolutionError;

export interface PathAdapter {
  resolve(...paths: string[]): string;
  normalize(p: string): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): string | boolean;
  sep: string;
}

export class ResourceResolver {
  constructor(
    private registry: ResourceRegistry,
    private auditManager?: AuditManager,
    private pathAdapter: PathAdapter = path,
  ) {}

  public getRegistry(): ResourceRegistry {
    return this.registry;
  }

  public resolveResource(
    workspaceId: string,
    requestedPath?: string,
  ): ResourceResolutionResult {
    const ws = this.registry.getWorkspace(workspaceId);
    if (!ws) {
      const errReason = `RESOURCE DENIED: Unknown or unregistered workspace '${workspaceId}'.`;
      this.auditDenial(
        "UNKNOWN_WORKSPACE",
        workspaceId,
        requestedPath || "",
        errReason,
      );
      return {
        success: false,
        code: "UNKNOWN_WORKSPACE",
        error: errReason,
      };
    }

    const effectiveWorkspaceId = ws.workspaceId;

    if (
      !requestedPath ||
      typeof requestedPath !== "string" ||
      !requestedPath.trim()
    ) {
      const errReason = `RESOURCE DENIED: Target path is required for workspace '${effectiveWorkspaceId}'.`;
      this.auditDenial("INVALID_PATH", effectiveWorkspaceId, "", errReason);
      return {
        success: false,
        code: "INVALID_PATH",
        error: errReason,
      };
    }

    const rawPath = requestedPath.trim();

    // 1. Prevent path traversal sequences (.. in path components)
    if (rawPath.includes("..")) {
      const errReason = `RESOURCE DENIED: Path traversal sequence '..' detected in '${rawPath}' for workspace '${effectiveWorkspaceId}'.`;
      this.auditDenial(
        "PATH_TRAVERSAL",
        effectiveWorkspaceId,
        rawPath,
        errReason,
      );
      return {
        success: false,
        code: "PATH_TRAVERSAL",
        error: errReason,
      };
    }

    // 2. Check for trailing dots/spaces in Windows path variants (e.g. C:\path. or C:\path )
    if (/[. ]+(\/|\\|$)/.test(rawPath) && rawPath !== "." && rawPath !== "..") {
      const cleanEnd = rawPath.replace(/[. ]+$/, "");
      if (cleanEnd !== rawPath) {
        const errReason = `RESOURCE DENIED: Path '${rawPath}' contains trailing dots/spaces bypass attempt for workspace '${effectiveWorkspaceId}'.`;
        this.auditDenial(
          "TRAILING_CHAR_BYPASS",
          effectiveWorkspaceId,
          rawPath,
          errReason,
        );
        return {
          success: false,
          code: "TRAILING_CHAR_BYPASS",
          error: errReason,
        };
      }
    }

    // 3. Normalize & resolve canonical real path
    let targetNormalized = this.pathAdapter.normalize(rawPath);

    if (!this.pathAdapter.isAbsolute(targetNormalized)) {
      const primaryRoot =
        ws.allowedRoots.find((r) => fs.existsSync(r)) || ws.allowedRoots[0];
      targetNormalized = this.pathAdapter.resolve(primaryRoot, rawPath);
    }

    const has83Pattern = /~[0-9]/.test(rawPath);
    const { canonical: canonicalPath } =
      this.resolveCanonicalPath(targetNormalized);

    let realTargetPathNorm = canonicalPath;
    if (fs.existsSync(targetNormalized)) {
      try {
        const realTargetPath = fs.realpathSync(targetNormalized);
        realTargetPathNorm = this.pathAdapter.normalize(realTargetPath);
      } catch {
        // Fall back to canonicalPath
      }
    }

    // 4. Evaluate workspace containment against authorized roots
    let matchedRoot: string | undefined;
    for (const allowedRoot of ws.allowedRoots) {
      const canonicalRoot = this.resolveCanonicalPath(allowedRoot).canonical;
      const realAllowedRoot = fs.existsSync(allowedRoot)
        ? this.pathAdapter.normalize(fs.realpathSync(allowedRoot))
        : canonicalRoot;

      if (
        this.isPathContained(allowedRoot, targetNormalized) ||
        this.isPathContained(allowedRoot, canonicalPath) ||
        this.isPathContained(allowedRoot, realTargetPathNorm) ||
        this.isPathContained(canonicalRoot, targetNormalized) ||
        this.isPathContained(canonicalRoot, canonicalPath) ||
        this.isPathContained(canonicalRoot, realTargetPathNorm) ||
        this.isPathContained(realAllowedRoot, realTargetPathNorm)
      ) {
        matchedRoot = allowedRoot;
        break;
      }
    }

    // 5. If not contained in authorized roots, determine escape classification
    if (!matchedRoot) {
      const otherWorkspace =
        this.findWorkspaceOwningPath(targetNormalized, effectiveWorkspaceId) ||
        this.findWorkspaceOwningPath(canonicalPath, effectiveWorkspaceId) ||
        this.findWorkspaceOwningPath(realTargetPathNorm, effectiveWorkspaceId);

      if (otherWorkspace) {
        const errReason = `RESOURCE DENIED: Cross-workspace access attempt. Path '${rawPath}' belongs to workspace '${otherWorkspace}' and is denied for workspace '${effectiveWorkspaceId}'.`;
        this.auditDenial(
          "CROSS_WORKSPACE_ACCESS",
          effectiveWorkspaceId,
          rawPath,
          errReason,
        );
        return {
          success: false,
          code: "CROSS_WORKSPACE_ACCESS",
          error: errReason,
        };
      }

      const siblingAttempt = ws.allowedRoots.some((allowedRoot) => {
        const canonicalRoot = this.resolveCanonicalPath(allowedRoot).canonical;
        return (
          targetNormalized
            .toLowerCase()
            .startsWith(allowedRoot.toLowerCase()) ||
          canonicalPath.toLowerCase().startsWith(allowedRoot.toLowerCase()) ||
          canonicalPath.toLowerCase().startsWith(canonicalRoot.toLowerCase()) ||
          realTargetPathNorm
            .toLowerCase()
            .startsWith(canonicalRoot.toLowerCase())
        );
      });

      if (siblingAttempt) {
        const errReason = `RESOURCE DENIED: Sibling prefix bypass attempt detected on '${rawPath}' for workspace '${effectiveWorkspaceId}'.`;
        this.auditDenial(
          "SIBLING_PREFIX_BYPASS",
          effectiveWorkspaceId,
          rawPath,
          errReason,
        );
        return {
          success: false,
          code: "SIBLING_PREFIX_BYPASS",
          error: errReason,
        };
      }

      const errReason = `RESOURCE DENIED: Target path '${rawPath}' (resolved: '${realTargetPathNorm}') escapes authorized workspace roots [${ws.allowedRoots.join(", ")}] for workspace '${effectiveWorkspaceId}'.`;
      this.auditDenial(
        "UNAUTHORIZED_ROOT",
        effectiveWorkspaceId,
        rawPath,
        errReason,
      );
      return {
        success: false,
        code: "UNAUTHORIZED_ROOT",
        error: errReason,
      };
    }

    // 6. Symlink / Junction Escape Check
    if (fs.existsSync(targetNormalized)) {
      let realMatchFound = false;
      for (const allowedRoot of ws.allowedRoots) {
        const realAllowedRoot = fs.existsSync(allowedRoot)
          ? this.pathAdapter.normalize(fs.realpathSync(allowedRoot))
          : this.pathAdapter.normalize(allowedRoot);

        if (this.isPathContained(realAllowedRoot, realTargetPathNorm)) {
          realMatchFound = true;
          break;
        }
      }

      if (!realMatchFound) {
        const errReason = `RESOURCE DENIED: Symlink/Junction target '${realTargetPathNorm}' escapes authorized roots for workspace '${effectiveWorkspaceId}'.`;
        this.auditDenial(
          "SYMLINK_ESCAPE",
          effectiveWorkspaceId,
          rawPath,
          errReason,
        );
        return {
          success: false,
          code: "SYMLINK_ESCAPE",
          error: errReason,
        };
      }
    }

    // 7. Alternate 8.3 short-name representation check
    if (has83Pattern && /~[0-9]/.test(realTargetPathNorm)) {
      const errReason = `RESOURCE DENIED: Alternate 8.3 short-name representation detected in '${rawPath}' for workspace '${effectiveWorkspaceId}'.`;
      this.auditDenial(
        "EIGHT_DOT_THREE_BYPASS",
        effectiveWorkspaceId,
        rawPath,
        errReason,
      );
      return {
        success: false,
        code: "EIGHT_DOT_THREE_BYPASS",
        error: errReason,
      };
    }

    // 8. Repository Binding
    let repositoryId: string | undefined;
    if (ws.repositories) {
      for (const repo of ws.repositories) {
        if (
          this.isPathContained(repo.root, realTargetPathNorm) ||
          this.isPathContained(repo.root, targetNormalized)
        ) {
          repositoryId = repo.repositoryId;
          break;
        }
      }
    }

    const resource: ResolvedResource = Object.freeze({
      [RESOLVED_RESOURCE_BRAND]: true as const,
      workspaceId: effectiveWorkspaceId,
      canonicalPath: realTargetPathNorm,
      allowedRoot: matchedRoot,
      repositoryId,
    });

    return {
      success: true,
      resource,
    };
  }

  /**
   * TOCTOU RISK DOCUMENTATION:
   * System filesystem operations execute after resource resolution. While ResourceResolver
   * resolves symlinks, junctions, and normalizes paths at authorization time, a concurrent
   * filesystem modification (e.g. replacing a directory with a symlink between resolution
   * and tool execution) poses a residual Time-of-Check to Time-of-Use (TOCTOU) risk.
   * On Windows NTFS, atomic file handles or OS-level file locking can mitigate this,
   * but cross-process filesystem race conditions remain inherently possible at the OS boundary.
   */
  private isPathContained(parentRoot: string, childPath: string): boolean {
    // Strip extended path prefix \\?\ if present for normalization
    let parentClean = parentRoot.startsWith("\\\\?\\")
      ? parentRoot.substring(4)
      : parentRoot;
    let childClean = childPath.startsWith("\\\\?\\")
      ? childPath.substring(4)
      : childPath;

    const parentNorm = this.pathAdapter.normalize(parentClean);
    const childNorm = this.pathAdapter.normalize(childClean);

    // Drive letter comparison for Windows
    const parentDriveMatch = parentNorm.match(/^([a-zA-Z]:)/);
    const childDriveMatch = childNorm.match(/^([a-zA-Z]:)/);

    if (parentDriveMatch || childDriveMatch) {
      if (
        !parentDriveMatch ||
        !childDriveMatch ||
        parentDriveMatch[1].toLowerCase() !== childDriveMatch[1].toLowerCase()
      ) {
        return false;
      }
    }

    // UNC server/share boundary check
    const isParentUnc = parentNorm.startsWith("\\\\");
    const isChildUnc = childNorm.startsWith("\\\\");
    if (isParentUnc !== isChildUnc) {
      return false;
    }

    if (isParentUnc && isChildUnc) {
      // Compare UNC server and share parts: \\server\share
      const parentParts = parentNorm.substring(2).split(/[\\/]/);
      const childParts = childNorm.substring(2).split(/[\\/]/);

      if (
        parentParts.length < 2 ||
        childParts.length < 2 ||
        parentParts[0].toLowerCase() !== childParts[0].toLowerCase() ||
        parentParts[1].toLowerCase() !== childParts[1].toLowerCase()
      ) {
        return false;
      }
    }

    const rel = this.pathAdapter.relative(parentNorm, childNorm);
    if (!rel) return true; // Exact match
    if (rel.startsWith("..")) return false;
    if (this.pathAdapter.isAbsolute(rel)) return false;

    // Strict containment verification using path separator boundaries
    const sep = this.pathAdapter.sep || "/";
    const parentEndsWithSep =
      parentNorm.endsWith("/") || parentNorm.endsWith("\\");
    const parentPrefixWithSep = parentEndsWithSep
      ? parentNorm
      : parentNorm + sep;

    return (
      childNorm.toLowerCase() === parentNorm.toLowerCase() ||
      childNorm.toLowerCase().startsWith(parentPrefixWithSep.toLowerCase())
    );
  }

  private resolveCanonicalPath(targetPath: string): {
    canonical: string;
    realExists: boolean;
  } {
    let current = targetPath;
    let tail = "";

    while (current) {
      if (fs.existsSync(current)) {
        try {
          const real = fs.realpathSync(current);
          const realNorm = this.pathAdapter.normalize(real);
          const full = tail
            ? this.pathAdapter.resolve(realNorm, tail)
            : realNorm;
          return { canonical: full, realExists: true };
        } catch {
          break;
        }
      }
      const lastSepIndex = Math.max(
        current.lastIndexOf("/"),
        current.lastIndexOf("\\"),
      );
      if (lastSepIndex <= 0) break;

      const parent = this.pathAdapter.normalize(
        current.substring(0, lastSepIndex),
      );
      const base = current.substring(lastSepIndex + 1);

      if (!parent || parent === current) break;
      const sep = this.pathAdapter.sep || "/";
      tail = tail ? `${base}${sep}${tail}` : base;
      current = parent;
    }

    return { canonical: targetPath, realExists: false };
  }

  private findWorkspaceOwningPath(
    targetPath: string,
    currentWorkspaceId: string,
  ): string | undefined {
    for (const ws of this.registry.listWorkspaces()) {
      if (ws.workspaceId === currentWorkspaceId) continue;
      for (const root of ws.allowedRoots) {
        if (this.isPathContained(root, targetPath)) {
          return ws.workspaceId;
        }
      }
    }
    return undefined;
  }

  private auditDenial(
    code: ResourceResolutionError["code"],
    workspaceId: string,
    requestedPath: string,
    reason: string,
  ): void {
    if (this.auditManager) {
      this.auditManager
        .recordEvent(
          "RESOURCE_AUTHORIZATION_DENIED",
          {
            code,
            workspaceId,
            requestedPath,
            reason,
          },
          {
            workspaceId,
            severity: "HIGH",
          },
        )
        .catch(() => {});
    }
  }
}
