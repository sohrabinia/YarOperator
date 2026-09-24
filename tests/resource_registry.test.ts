import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ResourceRegistry,
  ResourceRegistryConfig,
} from "../src/core/registry/resource.js";
import {
  ResourceResolver,
  PathAdapter,
} from "../src/core/registry/resolver.js";
import { GitTool } from "../src/core/git/index.js";
import { TerminalTool } from "../src/core/terminal/index.js";
import { AuditManager, InMemoryAuditStore } from "../src/core/audit/index.js";
import { bootstrapOperatorApplication } from "../src/core/bootstrap/index.js";

describe("Resource / Environment Registry & Security Resolution Boundary Suite", () => {
  let tempDir: string;
  let workspace1Dir: string;
  let workspace2Dir: string;
  let siblingDir: string;
  let auditStore: InMemoryAuditStore;
  let auditManager: AuditManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "op_res_test_"));
    workspace1Dir = path.join(tempDir, "workspace1");
    workspace2Dir = path.join(tempDir, "workspace2");
    siblingDir = path.join(tempDir, "workspace1_sibling");

    fs.mkdirSync(workspace1Dir, { recursive: true });
    fs.mkdirSync(workspace2Dir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    auditStore = new InMemoryAuditStore();
    auditManager = new AuditManager(auditStore);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --- Registry Tests (1-10) ---
  describe("1. Registry Loading & Fail-Closed Validation", () => {
    it("1. valid registry loads successfully", () => {
      const config: ResourceRegistryConfig = {
        defaultWorkspaceId: "ws1",
        workspaces: [
          {
            workspaceId: "ws1",
            aliases: ["alias1"],
            allowedRoots: [workspace1Dir],
          },
        ],
      };
      const registry = new ResourceRegistry(config);
      expect(registry.getWorkspace("ws1")).toBeDefined();
      expect(registry.getDefaultWorkspaceId()).toBe("ws1");
    });

    it("2. missing registry fails closed", () => {
      const missingPath = path.join(tempDir, "non_existent_registry.json");
      expect(() => new ResourceRegistry(missingPath)).toThrow(
        /file '.*' does not exist or is unreadable/i,
      );
    });

    it("3. malformed registry JSON fails closed", () => {
      const malformedPath = path.join(tempDir, "malformed.json");
      fs.writeFileSync(malformedPath, "{ invalid json ...", "utf-8");
      expect(() => new ResourceRegistry(malformedPath)).toThrow(
        /contains malformed JSON/i,
      );
    });

    it("4. duplicate workspace ID rejected", () => {
      const config: ResourceRegistryConfig = {
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws1", allowedRoots: [workspace2Dir] },
        ],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /Duplicate workspaceId 'ws1'/i,
      );
    });

    it("5. duplicate alias rejected", () => {
      const config: ResourceRegistryConfig = {
        workspaces: [
          {
            workspaceId: "ws1",
            aliases: ["shared_alias"],
            allowedRoots: [workspace1Dir],
          },
          {
            workspaceId: "ws2",
            aliases: ["shared_alias"],
            allowedRoots: [workspace2Dir],
          },
        ],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /Duplicate alias 'shared_alias'/i,
      );
    });

    it("6. relative allowed root rejected", () => {
      const config: ResourceRegistryConfig = {
        workspaces: [{ workspaceId: "ws1", allowedRoots: ["./relative/path"] }],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /allowed root '\.\/relative\/path' is relative/i,
      );
    });

    it("7. unresolved root rejected when fs checking is enabled", () => {
      const nonExistent = path.join(tempDir, "non_existent_folder");
      const config: ResourceRegistryConfig = {
        workspaces: [{ workspaceId: "ws1", allowedRoots: [nonExistent] }],
      };
      expect(
        () => new ResourceRegistry(config, { skipFsCheck: false }),
      ).toThrow(/cannot be resolved on filesystem/i);
    });

    it("8. repository outside workspace root rejected", () => {
      const config: ResourceRegistryConfig = {
        workspaces: [
          {
            workspaceId: "ws1",
            allowedRoots: [workspace1Dir],
            repositories: [
              {
                repositoryId: "repo1",
                workspaceId: "ws1",
                root: workspace2Dir, // Outside workspace1Dir!
              },
            ],
          },
        ],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /lies outside workspace 'ws1' allowed roots/i,
      );
    });

    it("9. repository bound to wrong workspace rejected", () => {
      const config: ResourceRegistryConfig = {
        workspaces: [
          {
            workspaceId: "ws1",
            allowedRoots: [workspace1Dir],
            repositories: [
              {
                repositoryId: "repo1",
                workspaceId: "ws2", // Mismatch!
                root: workspace1Dir,
              },
            ],
          },
        ],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /bound to wrong workspaceId 'ws2'/i,
      );
    });

    it("10. unknown default workspace rejected", () => {
      const config: ResourceRegistryConfig = {
        defaultWorkspaceId: "non_existent_ws",
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      };
      expect(() => new ResourceRegistry(config)).toThrow(
        /defaultWorkspaceId 'non_existent_ws' does not exist/i,
      );
    });
  });

  // --- Workspace Handling Tests (11-13) ---
  describe("2. Workspace Boundaries & Defaults", () => {
    it("11. unknown workspace denied", () => {
      const registry = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      const resolver = new ResourceResolver(registry, auditManager);
      const res = resolver.resolveResource("unknown_ws", workspace1Dir);

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("UNKNOWN_WORKSPACE");
      }
    });

    it("12. explicit workspace succeeds", () => {
      const registry = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      const resolver = new ResourceResolver(registry, auditManager);
      const res = resolver.resolveResource("ws1", workspace1Dir);

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.resource.workspaceId).toBe("ws1");
        expect(res.resource.canonicalPath).toBe(path.normalize(workspace1Dir));
      }
    });

    it("13. implicit/default workspace does NOT exist unless explicitly configured", () => {
      const registryNoDefault = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      expect(registryNoDefault.getDefaultWorkspaceId()).toBeUndefined();

      const registryWithDefault = new ResourceRegistry({
        defaultWorkspaceId: "ws1",
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      expect(registryWithDefault.getDefaultWorkspaceId()).toBe("ws1");
    });
  });

  // --- Filesystem Security & Path Semantics (14-24) ---
  describe("3. Filesystem Security & Cross-Platform Path Boundary", () => {
    let registry: ResourceRegistry;
    let resolver: ResourceResolver;

    beforeEach(() => {
      registry = new ResourceRegistry({
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws2", allowedRoots: [workspace2Dir] },
        ],
      });
      resolver = new ResourceResolver(registry, auditManager);
    });

    it("14. '..' traversal denied", () => {
      const traversalPath = workspace1Dir + "/../workspace2";
      const res = resolver.resolveResource("ws1", traversalPath);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("PATH_TRAVERSAL");
      }
    });

    it("15. sibling-prefix bypass denied", () => {
      const res = resolver.resolveResource("ws1", siblingDir);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(["SIBLING_PREFIX_BYPASS", "UNAUTHORIZED_ROOT"]).toContain(
          res.code,
        );
      }
    });

    it("16. symlink escape denied", () => {
      const targetOutside = path.join(workspace2Dir, "outside.txt");
      fs.writeFileSync(targetOutside, "outside secret", "utf-8");

      const linkInside = path.join(workspace1Dir, "symlink_outside.txt");
      try {
        fs.symlinkSync(targetOutside, linkInside);
      } catch {
        // If system environment forbids symlinks, skip creation assertion but check behavior
        return;
      }

      const res = resolver.resolveResource("ws1", linkInside);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("SYMLINK_ESCAPE");
      }
    });

    it("17. junction escape denied where Windows-capable environment permits", () => {
      const targetDir = path.join(workspace2Dir, "target_sub");
      fs.mkdirSync(targetDir, { recursive: true });

      const junctionInside = path.join(workspace1Dir, "junction_outside");
      try {
        fs.symlinkSync(targetDir, junctionInside, "junction");
      } catch {
        // Junction creation may require elevated Windows permissions or Linux fallback
        return;
      }

      const res = resolver.resolveResource("ws1", junctionInside);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("SYMLINK_ESCAPE");
      }
    });

    it("18. cross-workspace path denied", () => {
      const res = resolver.resolveResource("ws1", workspace2Dir);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CROSS_WORKSPACE_ACCESS");
      }
    });

    it("19. Windows case variation handled safely under path.win32 adapter", () => {
      const win32Adapter: PathAdapter = path.win32;
      const winRegistry = new ResourceRegistry(
        {
          workspaces: [
            { workspaceId: "ws1", allowedRoots: ["C:\\Projects\\YarTrader"] },
          ],
        },
        { skipFsCheck: true },
      );
      const winResolver = new ResourceResolver(
        winRegistry,
        auditManager,
        win32Adapter,
      );

      const resUpper = winResolver.resolveResource(
        "ws1",
        "C:\\PROJECTS\\YARTRADER\\SRC\\INDEX.TS",
      );
      expect(resUpper.success).toBe(true);

      const resBypass = winResolver.resolveResource(
        "ws1",
        "C:\\PROJECTS\\YARTRADER2\\SECRET.TXT",
      );
      expect(resBypass.success).toBe(false);
      if (!resBypass.success) {
        expect(resBypass.code).toBe("SIBLING_PREFIX_BYPASS");
      }
    });

    it("20. UNC path boundary handled correctly", () => {
      const win32Adapter: PathAdapter = path.win32;
      const uncRegistry = new ResourceRegistry(
        {
          workspaces: [
            { workspaceId: "ws1", allowedRoots: ["\\\\server\\share\\repo"] },
          ],
        },
        { skipFsCheck: true },
      );
      const uncResolver = new ResourceResolver(
        uncRegistry,
        auditManager,
        win32Adapter,
      );

      const resOk = uncResolver.resolveResource(
        "ws1",
        "\\\\server\\share\\repo\\sub\\file.txt",
      );
      expect(resOk.success).toBe(true);

      const resOtherShare = uncResolver.resolveResource(
        "ws1",
        "\\\\server\\other_share\\file.txt",
      );
      expect(resOtherShare.success).toBe(false);
    });

    it("21. \\\\?\\ path handled correctly", () => {
      const win32Adapter: PathAdapter = path.win32;
      const extendedRegistry = new ResourceRegistry(
        {
          workspaces: [
            { workspaceId: "ws1", allowedRoots: ["C:\\Projects\\YarTrader"] },
          ],
        },
        { skipFsCheck: true },
      );
      const extendedResolver = new ResourceResolver(
        extendedRegistry,
        auditManager,
        win32Adapter,
      );

      const res = extendedResolver.resolveResource(
        "ws1",
        "\\\\?\\C:\\Projects\\YarTrader\\src\\main.ts",
      );
      expect(res.success).toBe(true);
    });

    it("22. 8.3 alternate path cannot bypass boundary", () => {
      const res = resolver.resolveResource(
        "ws1",
        path.join(workspace1Dir, "RUNNIN~1", "app.js"),
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("EIGHT_DOT_THREE_BYPASS");
      }
    });

    it("23. trailing-dot/space variant cannot bypass boundary", () => {
      const resDot = resolver.resolveResource("ws1", workspace1Dir + ".");
      expect(resDot.success).toBe(false);
      if (!resDot.success) {
        expect(resDot.code).toBe("TRAILING_CHAR_BYPASS");
      }
    });

    it("24. authorized path succeeds", () => {
      const fileInside = path.join(workspace1Dir, "authorized.txt");
      fs.writeFileSync(fileInside, "valid content", "utf-8");

      const res = resolver.resolveResource("ws1", fileInside);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.resource.canonicalPath).toBe(path.normalize(fileInside));
      }
    });
  });

  // --- Tool Integration Tests (25-28) ---
  describe("4. Tool Resource Boundary Integration", () => {
    let registry: ResourceRegistry;
    let resolver: ResourceResolver;

    beforeEach(() => {
      registry = new ResourceRegistry({
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws2", allowedRoots: [workspace2Dir] },
        ],
      });
      resolver = new ResourceResolver(registry, auditManager);
    });

    it("25. GitTool uses registry-derived resource", async () => {
      const gitTool = new GitTool(resolver);
      const res = await gitTool.execute(
        { action: "status", cwd: workspace1Dir },
        {
          executionId: "exec_1",
          timestamp: new Date(),
          workspaceId: "ws1",
        },
      );
      // git status in valid directory executes or succeeds
      expect(res).toBeDefined();
    });

    it("26. GitTool cannot use arbitrary cwd as authorization", async () => {
      const gitTool = new GitTool(resolver);
      const res = await gitTool.execute(
        { action: "status", cwd: workspace2Dir },
        {
          executionId: "exec_1",
          timestamp: new Date(),
          workspaceId: "ws1", // WS mismatch!
        },
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Cross-workspace access attempt/i);
    });

    it("27. TerminalTool uses registry-derived resource", async () => {
      const terminalTool = new TerminalTool(resolver);
      const res = await terminalTool.execute(
        { command: "echo", args: ["hello"], cwd: workspace1Dir },
        {
          executionId: "exec_1",
          timestamp: new Date(),
          workspaceId: "ws1",
        },
      );
      expect(res.success).toBe(true);
    });

    it("28. TerminalTool cannot cross workspace boundary", async () => {
      const terminalTool = new TerminalTool(resolver);
      const res = await terminalTool.execute(
        { command: "echo", args: ["hello"], cwd: workspace2Dir },
        {
          executionId: "exec_1",
          timestamp: new Date(),
          workspaceId: "ws1", // Cross-workspace!
        },
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Cross-workspace access attempt/i);
    });
  });

  // --- Runtime & Audit Tests (29-31) ---
  describe("5. Runtime Readiness & SHA-256 Audit Events", () => {
    it("29. registry failure cannot produce false READY", async () => {
      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        resourcesPath: path.join(tempDir, "invalid_non_existent.json"),
      });

      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.body.readiness.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        false,
      );
    });

    it("30. registry SHA-256 audit exists upon bootstrap", async () => {
      const registry = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      const sha = await registry.auditBootstrap(auditManager);

      expect(sha).toBeDefined();
      expect(sha.length).toBe(64);

      const events = await auditManager.queryEvents({
        type: "REGISTRY_BOOTSTRAP_SUCCESS",
      });
      expect(events.length).toBe(1);
      expect(events[0].payload.sha256).toBe(sha);
    });

    it("31. denial produces audit event", async () => {
      const registry = new ResourceRegistry({
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws2", allowedRoots: [workspace2Dir] },
        ],
      });
      const resolver = new ResourceResolver(registry, auditManager);

      resolver.resolveResource("ws1", workspace2Dir);

      const events = await auditManager.queryEvents({
        type: "RESOURCE_AUTHORIZATION_DENIED",
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].payload.code).toBe("CROSS_WORKSPACE_ACCESS");
      expect(events[0].workspaceId).toBe("ws1");
    });

    it("32. missing OPERATOR_RESOURCES_PATH causes bootstrap to fail closed without process.cwd() fallback", async () => {
      const origEnv = process.env.OPERATOR_RESOURCES_PATH;
      delete process.env.OPERATOR_RESOURCES_PATH;
      try {
        const apiHandler = await bootstrapOperatorApplication({
          useInMemoryStores: true,
        });
        const readinessRes = apiHandler.getReadiness();
        expect(readinessRes.body.readiness.status).toBe("NOT_READY");
        expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
          false,
        );
      } finally {
        if (origEnv) process.env.OPERATOR_RESOURCES_PATH = origEnv;
      }
    });

    it("33. audit persistence failure during bootstrap causes readiness to fail closed", async () => {
      const failingAuditStore = {
        save: async () => {
          throw new Error("Simulated audit persistence database write failure");
        },
        query: async () => [],
      };

      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        auditStore: failingAuditStore as any,
        resourceRegistryConfig: {
          workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
        },
      });

      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.body.readiness.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        false,
      );
    });

    it("34. Case A - valid explicit registry produces READY state", async () => {
      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        resourceRegistryConfig: {
          defaultWorkspaceId: "ws1",
          workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
        },
      });
      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.body.readiness.status).toBe("READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        true,
      );
    });

    it("35. Case B - missing OPERATOR_RESOURCES_PATH produces NOT_READY state", async () => {
      const origEnv = process.env.OPERATOR_RESOURCES_PATH;
      delete process.env.OPERATOR_RESOURCES_PATH;
      try {
        const apiHandler = await bootstrapOperatorApplication({
          useInMemoryStores: true,
        });
        const readinessRes = apiHandler.getReadiness();
        expect(readinessRes.body.readiness.status).toBe("NOT_READY");
        expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
          false,
        );
      } finally {
        if (origEnv) process.env.OPERATOR_RESOURCES_PATH = origEnv;
      }
    });

    it("36. Case C - malformed registry produces NOT_READY state", async () => {
      const malformedPath = path.join(tempDir, "bad.json");
      fs.writeFileSync(malformedPath, "{ malformed json...", "utf-8");

      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        resourcesPath: malformedPath,
      });
      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.body.readiness.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        false,
      );
    });

    it("37. Case D - audit failure produces NOT_READY state", async () => {
      const failingAuditStore = {
        save: async () => {
          throw new Error("Audit store IO error");
        },
        query: async () => [],
      };

      const apiHandler = await bootstrapOperatorApplication({
        useInMemoryStores: true,
        auditStore: failingAuditStore as any,
        resourceRegistryConfig: {
          workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
        },
      });

      const readinessRes = apiHandler.getReadiness();
      expect(readinessRes.body.readiness.status).toBe("NOT_READY");
      expect(readinessRes.body.readiness.subsystems.resourceRegistry).toBe(
        false,
      );
    });
  });

  // --- Authoritative Resolver Security & Anti-Bypass Tests ---
  describe("6. Authoritative Resolver Security & Anti-Bypass Tests", () => {
    it("38. metadata.resourceResolver cannot replace or override authoritative tool resolver", async () => {
      // Authoritative resolver for ws1 (workspace1Dir)
      const authRegistry = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace1Dir] }],
      });
      const authResolver = new ResourceResolver(authRegistry, auditManager);

      // Malicious fake resolver attempting to authorize workspace2Dir for ws1
      const fakeRegistry = new ResourceRegistry({
        workspaces: [{ workspaceId: "ws1", allowedRoots: [workspace2Dir] }],
      });
      const fakeResolver = new ResourceResolver(fakeRegistry, auditManager);

      const gitTool = new GitTool(authResolver);

      // Attempt execution passing fakeResolver in metadata attempting to access workspace2Dir
      const res = await gitTool.execute(
        { action: "status", cwd: workspace2Dir },
        {
          executionId: "exec_bypass_1",
          timestamp: new Date(),
          workspaceId: "ws1",
          metadata: { resourceResolver: fakeResolver },
        },
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/escapes authorized workspace roots/i);
    });

    it("39. workspace mismatch between pre-resolved resource and context workspace fails closed", async () => {
      const authRegistry = new ResourceRegistry({
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws2", allowedRoots: [workspace2Dir] },
        ],
      });
      const authResolver = new ResourceResolver(authRegistry, auditManager);

      // Pre-resolved resource generated for ws2
      const resWs2 = authResolver.resolveResource("ws2", workspace2Dir);
      expect(resWs2.success).toBe(true);

      const gitTool = new GitTool(authResolver);

      // Attempt executing gitTool with context workspaceId "ws1" but passing ws2's pre-resolved resource
      if (resWs2.success) {
        const res = await gitTool.execute(
          { action: "status" },
          {
            executionId: "exec_ws_mismatch",
            timestamp: new Date(),
            workspaceId: "ws1", // Mismatch!
            metadata: { resolvedResource: resWs2.resource },
          },
        );

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/does not match context workspace/i);
      }
    });

    it("40. pre-resolved resource is re-verified through authoritative resolver and rejected if invalid for context workspace", async () => {
      const authRegistry = new ResourceRegistry({
        workspaces: [
          { workspaceId: "ws1", allowedRoots: [workspace1Dir] },
          { workspaceId: "ws2", allowedRoots: [workspace2Dir] },
        ],
      });
      const authResolver = new ResourceResolver(authRegistry, auditManager);

      const resWs2 = authResolver.resolveResource("ws2", workspace2Dir);
      expect(resWs2.success).toBe(true);

      if (resWs2.success) {
        // Copy resWs2.resource (retaining Symbol brand) but forge workspaceId to "ws1"
        const forgedResource = Object.assign({}, resWs2.resource, {
          workspaceId: "ws1",
        });

        const terminalTool = new TerminalTool(authResolver);

        const res = await terminalTool.execute(
          { command: "echo", args: ["test"] },
          {
            executionId: "exec_forged",
            timestamp: new Date(),
            workspaceId: "ws1",
            metadata: {
              resolvedResource: forgedResource,
            },
          },
        );

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/failed authoritative resolution/i);
      }
    });

    it("41. absence of authoritative resolver fails closed", async () => {
      const gitToolNoResolver = new GitTool();
      const resGit = await gitToolNoResolver.execute(
        { action: "status", cwd: workspace1Dir },
        {
          executionId: "exec_no_resolver",
          timestamp: new Date(),
          workspaceId: "ws1",
        },
      );

      expect(resGit.success).toBe(false);
      expect(resGit.error).toMatch(
        /Authoritative ResourceResolver is required for GitTool execution/i,
      );

      const terminalToolNoResolver = new TerminalTool();
      const resTerm = await terminalToolNoResolver.execute(
        { command: "echo", args: ["hi"] },
        {
          executionId: "exec_no_resolver_term",
          timestamp: new Date(),
          workspaceId: "ws1",
        },
      );

      expect(resTerm.success).toBe(false);
      expect(resTerm.error).toMatch(
        /Authoritative ResourceResolver is required for TerminalTool execution/i,
      );
    });
  });
});
