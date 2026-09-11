# YarTrader.Operator — CTO Project State

## 1. Snapshot

- **Repository**: `sohrabinia/YarTrader.Operator`
- **Operational Version**: `0.1.0` (defined in `package.json` and `src/index.ts`)
- **Current Roadmap Position**: **Phase 8.2 (Durable Scheduler) — COMPLETED & MERGED**
- **Next Official Roadmap Step**: **Phase 8.3 (Durable Retry & Continuation)** or **Phase 9 (Identity Migration)**
- **System Integrity & Verification Status**:
  - Test Suite: **182 vitest tests passing** across 35 test files (`npm test`)
  - TypeScript Compilation: **0 errors** (`npm run build` / `npm run lint`)
  - Code Formatting: **100% compliant** (`npm run format:check`)
  - Working-Tree State: **Clean** prior to handoff document creation
- **Hard Scope Boundary**: Documentation audit only; exactly one file (`docs/CTO_PROJECT_STATE.md`) created.

---

## 2. Repository Truth

- **Repository**: `sohrabinia/YarTrader.Operator` [FACT]
- **Current Branch**: `jules-7812311489395922734-bf1f3ed5` (tracking `origin/main`) [FACT]
- **HEAD SHA**: `e94287aa77a48eee8be18a36329ec9b4a848821e` [FACT]
- **origin/main SHA**: `e94287aa77a48eee8be18a36329ec9b4a848821e` [FACT]
- **Git Divergence State**: **In sync with origin/main** (0 commits ahead, 0 commits behind) [FACT]
- **Working-Tree State**: Clean (0 uncommitted changes prior to `docs/CTO_PROJECT_STATE.md` creation) [FACT]
- **Latest Relevant Commits on Main**:
  - `e94287a`: `Merge pull request #17 from sohrabinia/feat/phase-8.2-durable-scheduler-12486550626654870643-13668233168123173606` [FACT]
  - `69d75ba`: `feat(scheduler): implement durable scheduler` [FACT]
  - `ae7ec8a`: `feat(scheduler): implement durable scheduler` [FACT]
  - `fee7566`: `fix(security): enforce workspace policy at execution boundary` [FACT]
  - `0272c16`: `fix(owner): route conversational greetings outside tool execution` [FACT]
  - `8be396c`: `fix(web): use canonical yartrader workspace` [FACT]
  - `6eb67cc`: `fix(oidc): resolve OAuth authorization redirect host and ARR reverse rewrite settings` [FACT]
  - `8b275e1`: `fix(routing): add IIS auth routing contract` [FACT]
  - `c043494`: `feat: add Operator web runtime entrypoint` [FACT]
  - `8bd7025`: `fix: correct merged public exports` [FACT]
  - `9dbde00`: `feat: add controlled autonomy engine with real tool execution` [FACT]
  - `238fe3c`: `fix: stabilize phase 0-8.2 remediation cross-platform` (tagged `phase-0-8.2-stable`) [FACT]
- **Open Pull Requests**: **0 open PRs** (PR #17 successfully merged into `main`) [FACT]
- **Repository Clean Rebuild Origin**: The codebase is a clean sequential rebuild starting at commit `238fe3c` (`phase-0-8.2-stable`), completely decoupled from historical repository Git history (`sohrabinia/YarTrader.Operator` legacy or `sohrabinia/Operator`) [FACT - `docs/adrs/0001-clean-rebuild.md`].

---

## 3. Architecture

### Core Execution Model (`BRAIN ≠ HANDS`)

The central architectural directive of YarOperator is strict separation between reasoning/planning (**Brain**) and tool execution primitives (**Hands**) [FACT - `docs/architecture.md`, `docs/operator-model.md`].
The reasoning engine cannot directly access the operating system, filesystem, network, terminal, or browser. All tool execution must flow through a deterministic, governed execution pipeline [FACT]:

```
WorkflowEngine -> ExecutionEngine -> PolicyEngine -> ApprovalManager -> ToolRegistry -> Tool -> Adapter
```

### Task / Plan / Step Model

- **Task Lifecycle States**: `CREATED` -> `PLANNED` -> `ASSIGNED` -> `IN_PROGRESS` -> `REVIEW` -> `COMPLETED` / `FAILED` [FACT - `src/core/development/index.ts`].
- **Action / Step Risk Levels**:
  - `SAFE`: Read-only, non-destructive, zero side-effect operations (e.g. status queries, linting, reading public docs).
  - `APPROVAL_REQUIRED`: State-modifying operations (e.g. workspace edits, git commits, PR creation, external form submissions).
  - `BLOCKED`: Forbidden high-risk actions (e.g. financial transfers, credential scraping, security bypasses).

### State Machine & Persistence

- Operational state persistence is implemented using Node.js native SQLite (`node:sqlite` `DatabaseSync`) in `src/core/memory/operational.ts` (`OperationalStateStore`) [FACT].
- Stores lifecycle transitions, task execution metadata, durable schedules, and key-value state across process restarts without external database dependencies [FACT].

### Policy Engine

- `PolicyEngine` (`src/core/policy/index.ts`) enforces security policy classification [FACT].
- **Fail-Closed Rule**: Any unknown, unclassified, or ambiguous tool operation defaults immediately to `BLOCKED` [FACT].
- Explicit security precedence: `BLOCKED > APPROVAL_REQUIRED > SAFE` [FACT].

### Workspace Policy

- `WorkspacePolicy` and `WorkspacePolicyManager` (`src/core/workspace/policy.ts`) enforce workspace boundaries [FACT].
- **Path Containment**: `validateRoot` ensures file paths do not escape authorized workspace roots via path traversal (`..` or absolute paths outside the root) [FACT].
- **Tool Scoping**: `validateTool` restricts executable tools to explicit workspace allowlists [FACT].

### Approval Model

- `ApprovalManager` (`src/core/policy/index.ts`) handles single-use human owner approval tokens [FACT].
- Uses **SHA-256 parameter fingerprinting** (`createFingerprint`) to hash `toolId` and canonicalized JSON parameters [FACT].
- Single-use consumption (`consumeApproval`) prevents replay attacks; token status transitions from `PENDING` -> `APPROVED` -> `CONSUMED` or `EXPIRED` [FACT].

### Audit Model

- `AuditEngine` / `AuditManager` (`src/core/audit/index.ts`) acts as a strictly read-only observer logging operational events: `TASK_CREATED`, `DECISION_MADE`, `ACTION_STARTED`, `ACTION_COMPLETED`, `ACTION_FAILED`, `REVIEW_COMPLETED` [FACT].
- **Secret Redaction**: Automatically sanitizes sensitive parameters matching `PASSWORD`, `SECRET`, `TOKEN`, `KEY`, `COOKIE`, or `BEARER_TOKEN` prior to writing audit logs [FACT].
- Audit logs CANNOT modify `PolicyEngine` rules or self-grant approvals [FACT].

### Tool Model

- `SecureToolEcosystem` / `ToolRegistry` manages available tools [FACT]:
  - `TerminalTool` (`src/core/terminal/index.ts`): Workspace-scoped shell command execution with timeout and output truncation.
  - `BrowserTool` (`src/core/browser/index.ts`): Playwright web interaction tool (fails closed gracefully as `NOT_CONFIGURED` if browser driver is absent).
  - `ResearchTool` (`src/core/research/index.ts`): Web search and page fetch abstraction.
  - `GitTool` (`src/core/git/index.ts`): Git workspace operations and GitHub worker integrations.
  - `JulesWorker` (`src/core/agent/index.ts`): External AI agent proxy subject to strict stop conditions (`AGENTS.md`).

### Context Model

- `ContextEngine` and `WorkspaceContext` (`src/core/context/index.ts`) manage workspace-scoped context, ensuring context from one workspace does not leak into another [FACT].

### API & Operator Boundary

- `OperatorWebServer` (`src/web/server.ts`): Express/HTTP server bound by default to `127.0.0.1:3000` [FACT].
- Features: 1 MiB body limit, error details sanitization, OIDC / Google OAuth owner authentication, and IIS reverse proxy contract (`web.config`) [FACT].
- `OperatorApi` (`src/api/operator.ts`): Owner command intake that resolves natural-language goals without requiring explicit `requestedToolId`, performing capability routing and failing closed if no authorized tool is matched [FACT].

---

## 4. Completed Phases

| Phase         | Official Phase Name                  | Status        | Evidence / Verification                                                                                                                | Key Commits / PRs                                | Gaps / Remaining Items                          |
| :------------ | :----------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- | :---------------------------------------------- |
| **Phase 0**   | Architecture, Governance & Bootstrap | **COMPLETED** | `BootstrapEngine` implementation; tests in `tests/bootstrap.test.ts` passing                                                           | Tag `phase-0-8.2-stable` (`238fe3c`)             | None                                            |
| **Phase 1**   | Operator Core / Execution Engine     | **COMPLETED** | `ExecutionEngine` implementation; tests in `tests/engine.test.ts` passing                                                              | Commit `9dbde00`                                 | None                                            |
| **Phase 2**   | Terminal Operator                    | **COMPLETED** | `TerminalTool` with workspace restriction; tests in `tests/terminal.test.ts` passing                                                   | Commit `9dbde00`                                 | None                                            |
| **Phase 3**   | Browser Operator                     | **COMPLETED** | `BrowserTool` with Playwright fallback; tests in `tests/browser.test.ts` passing                                                       | Commit `8be396c`                                 | Host Playwright binary optional                 |
| **Phase 4**   | Web Research Operator                | **COMPLETED** | `ResearchTool` implementation; tests in `tests/research.test.ts` passing                                                               | Commit `9dbde00`                                 | None                                            |
| **Phase 5**   | Approval & Policy Engine             | **COMPLETED** | `PolicyEngine`, `ApprovalManager` with SHA-256 fingerprinting; tests in `tests/policy.test.ts` passing                                 | Commit `fee7566`                                 | None                                            |
| **Phase 6**   | Git / GitHub + Jules Worker          | **COMPLETED** | `GitTool`, `JulesWorker`, `AGENTS.md` stop rules; tests in `tests/git.test.ts` passing                                                 | Commit `9dbde00`                                 | None                                            |
| **Phase 7**   | Workflow Engine                      | **COMPLETED** | `WorkflowEngine` DAG step execution; tests in `tests/workflow.test.ts` passing                                                         | Commit `9dbde00`                                 | None                                            |
| **Phase 8.1** | Durable Operational Memory           | **COMPLETED** | `OperationalStateStore` using `node:sqlite`; tests in `tests/durable_operational_memory.test.ts` passing                               | Commit `c043494`                                 | Semantic memory explicitly out of scope         |
| **Phase 8.2** | Durable Scheduler                    | **COMPLETED** | `DurableScheduler` using `node:sqlite` with CRON, INTERVAL, ONCE, DST/IANA support; tests in `tests/durable_scheduler.test.ts` passing | PR #17 (`e94287a`, commits `ae7ec8a`, `69d75ba`) | Decoupled execution (does not run payload code) |

---

## 5. Locked Roadmap Position

The locked roadmap sequence as established in `docs/roadmap.md` is strictly defined as:

```
Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7 -> Phase 8.1 -> Phase 8.2 -> Phase 9 (Identity Migration) -> Phase 10 (Core Operating Model) -> Phase 11 (Runtime Context & Workspace) -> Phase 12 (Memory Engine) -> Phase 13 (Execution Logging & Self Audit) -> Phase 14 (Development Assistant Mode) -> Phase 15 (Owner Profile & Preference Model) -> Phase 16-26 (Autonomous Development Loop Framework) -> STOP
```

### Position Summary

- **Completed Phases**: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8.1, Phase 8.2 [FACT].
- **Current Position**: **Phase 8.2 COMPLETED and MERGED into `main`** (Commit `e94287a`) [FACT].
- **Next Official Phase**: **Phase 8.3 (Durable Retry & Continuation)** or **Phase 9 (Identity Migration)** [FACT].
- **Phases Intentionally Not Started**: Phase 8.3/8.4/8.5, Phase 9 through Phase 26 [FACT].
- **Explicit Roadmap Exclusions**:
  - No vector databases, semantic RAG, or natural-language embedding stores in Phase 8 [FACT].
  - No direct code execution inside scheduler payloads [FACT].
  - No client-side or UI-based tool, agent, or provider selection [FACT].
  - No migration or duplication of YarTrader domain trading code into YarOperator [FACT].
  - No permanent agents created other than the 5 authorized high-level roles (Strategy, CTO, Research, Growth, Risk) [FACT].

---

## 6. Security Model

### Security Classification Precedence

Every operation evaluated by YarOperator is classified into one of three risk levels [FACT]:

1. `SAFE`: Read-only, non-destructive actions.
2. `APPROVAL_REQUIRED`: State-modifying actions requiring explicit owner single-use approval.
3. `BLOCKED`: Forbidden high-risk actions.

**Strict Security Precedence Rule**:
`BLOCKED > APPROVAL_REQUIRED > SAFE` [FACT - `docs/architecture.md`]

### Core Security Invariants

- **Fail-Closed Default**: Any unknown, unclassified, or ambiguous tool request defaults to `BLOCKED` [FACT - `src/core/policy/index.ts`].
- **Workspace Path Containment**: `WorkspacePolicy.validateRoot` verifies that target paths resolve within authorized workspace roots, preventing path traversal attacks (`..` or escaped absolute paths) [FACT - `src/core/workspace/policy.ts`].
- **Single-Use Approval Fingerprints**: `ApprovalManager` generates SHA-256 hashes of tool IDs and canonicalized parameters. Once an approval token is consumed (`status = 'CONSUMED'`), re-using the token triggers replay attack prevention and fails closed [FACT - `src/core/policy/index.ts`].
- **Secret & Credential Redaction**: `AuditManager` and `OperationalStateStore` sanitize values matching sensitive keywords (`PASSWORD`, `SECRET`, `TOKEN`, `KEY`, `COOKIE`, `BEARER_TOKEN`) [FACT].
- **Web Runtime Security Boundary**:
  - `OperatorWebServer` binds exclusively to `127.0.0.1` (localhost-only) [FACT - `src/web/server.ts`].
  - IIS ARR reverse proxy rewrite rules (`web.config`) sanitize incoming HTTP headers and enforce OIDC user identity mapping [FACT].
  - Request body streaming limit enforced at 1 MiB [FACT].
  - Internal server error details sanitized to prevent system stack trace leaks [FACT].

---

## 7. YarTrader Integration Status

- **Operational Relationship**: YarTrader is managed as an isolated target **Workspace** (`workspaceId: "yartrader"`) by YarOperator [FACT - `src/web/server.ts`, `docs/workspace-model.md`].
- **Verified Fact — What Exists**: YarOperator orchestrates developer tasks, test executions, Git branch workflows, build checks, and scheduler jobs targeting the YarTrader codebase [FACT].
- **Verified Fact — What Does NOT Exist**:
  - YarTrader domain trading logic is **NOT** present or duplicated inside YarOperator [FACT].
  - YarOperator does **NOT** execute live trading strategies, order execution, or financial exchange connections [FACT].
  - YarOperator does **NOT** run in-process inside YarTrader [FACT].
- **Responsibility Boundary**:
  - **YarTrader**: Owns financial trading logic, strategy execution, order routing, and market data processing [FACT].
  - **YarOperator**: Owns personal AI operator orchestration, governance, developer automation, durable scheduling, and workspace policy enforcement [FACT].

---

## 8. Operator Mission

The long-term mission of YarOperator is to serve as an independent, trusted Personal AI Operator foundation and executive proxy for its human owner (Mohammad) [FACT - `docs/vision.md`].

### Operational Architecture Map

- **BRAIN (Reasoning & Context)**: Formulates plans, decomposes natural-language goals into structured DAG steps, evaluates risk tiers, and manages workspace state transitions (`WorkflowEngine`, `ContextEngine`, `ControlledAutonomyEngine`).
- **EARS (Information Intake)**: Receives owner commands, web UI inputs, webhook events, and durable scheduler time triggers (`OperatorApi`, `OperatorWebServer`, `DurableScheduler`).
- **MOUTH (Communication & Auditing)**: Communicates status reports, presents single-use approval requests, outputs structured audit trails, and sends notifications (`AuditManager`, `NotificationManager`, Operator UI).
- **HANDS (Governed Execution)**: Executes specific, governed operations through explicit tool adapters (`TerminalTool`, `BrowserTool`, `ResearchTool`, `GitTool`, `JulesWorker`) under the authoritative control of `PolicyEngine` and `ApprovalManager`.

---

## 9. Missing Capabilities

The following capabilities are explicitly absent from the current codebase and roadmap position:

1. **Durable Retry & Continuation Engine** (Phase 8.3) [FACT]
2. **Crash Recovery & State Resume** (Phase 8.4) [FACT]
3. **Autonomous Daemon / Polling Loop** (Phase 8.5) [FACT]
4. **Identity & User Mapping Migration** (Phase 9) [FACT]
5. **Core Operating Model Expansion** (Phase 10) [FACT]
6. **Runtime Context & Workspace Isolation Engine Expansion** (Phase 11) [FACT]
7. **Semantic Memory / Vector RAG Engine** (Phase 12) [FACT]
8. **Execution Logging & Self-Audit Trail Analysis** (Phase 13) [FACT]
9. **Development Assistant Mode Engine Expansion** (Phase 14) [FACT]
10. **Owner Profile & Preference Engine** (Phase 15) [FACT]
11. **Autonomous Development Loop Framework** (Phases 16–26) [FACT]

---

## 10. Known Risks / Open Questions

### Confirmed Issues

- **None**. All 182 test cases across 35 test suites pass with 0 compilation or linting errors [FACT].

### Known Limitations

- **Browser Driver Dependency**: `BrowserTool` relies on Playwright. If Playwright binaries are not installed on the host environment, `BrowserTool` fails closed gracefully with status `NOT_CONFIGURED` without crashing the process [FACT - `tests/browser.test.ts`].
- **Single-Node Persistence**: `OperationalStateStore` and `DurableScheduler` rely on Node.js native SQLite (`node:sqlite`). State persistence is local to the server node and does not support distributed database synchronization [FACT - `docs/scheduler-model.md`].

### Architectural Decisions Pending

- **Phase 8.3 vs Phase 9 Prioritization**: CTO review required to confirm whether Phase 8.3 (Durable Retry & Continuation) or Phase 9 (Identity Migration) is the next immediate implementation target.

### Unknowns Requiring Future Investigation

- **IIS ARR Reverse Proxy Host Name Binding in Remote Mobile Deployment**: While desktop OIDC authentication is verified, remote mobile domain routing under custom subdomains requires live infrastructure verification [FACT - `AGENTS.md` Stop Condition 8].

---

## 11. Current Next-Step Boundary

### What Has Been Completed

- **Phases 0 through 8.2** are fully implemented, verified, tested, and merged into `main` at commit `e94287a` [FACT].

### What Must NOT Be Worked On Yet

- **DO NOT** re-implement or modify code for completed Phases 0 through 8.2 [FACT].
- **DO NOT** start coding Phase 8.3, Phase 9, or any subsequent phase without explicit owner/CTO direction and an approved Phase A architectural plan [FACT].
- **DO NOT** create parallel execution engines, parallel schedulers, or bypass `PolicyEngine` / `ApprovalManager` [FACT].

### Next Official Roadmap Step

- **Phase 8.3 (Durable Retry & Continuation)** OR **Phase 9 (Identity Migration)** as selected by CTO [FACT].

### Evidence Required Before Advancing

1. Explicit written direction from owner (Mohammad) selecting the next phase.
2. Approved Phase A Architectural Plan submitted via `request_plan_review`.
3. Green test suite run (`npm test`) confirming 0 regressions.

---

## 12. CTO Handoff for Future Sessions

This section provides direct, unambiguous answers for any future ChatGPT / AI session resuming work on `sohrabinia/YarTrader.Operator`:

1. **"Where are we?"**
   - We are at the completion boundary of **Phase 8.2 (Durable Scheduler)**.
   - The repository is fully merged, stable, and clean on `main` at commit `e94287a`.

2. **"What has been verified?"**
   - The entire test suite (182 tests, 35 files) is passing (`npm test`).
   - TypeScript compilation (`npm run build`), linting (`npm run lint`), and formatting (`npm run format:check`) are completely clean.

3. **"What must I NOT assume?"**
   - Do NOT assume that YarOperator contains live trading execution code for YarTrader. YarTrader trading logic is completely separate.
   - Do NOT assume that `DurableScheduler` executes payload code dynamically. Execution is decoupled.
   - Do NOT assume that memory includes vector RAG or semantic embeddings; Phase 8.1/8.2 memory is deterministic SQLite operational state.

4. **"What is the current official roadmap position?"**
   - Phase 8.2 is COMPLETED.
   - The next official roadmap step is **Phase 8.3 (Durable Retry & Continuation)** or **Phase 9 (Identity Migration)**.

5. **"What should be reviewed before giving Jules the next implementation task?"**
   - Review `AGENTS.md` for explicit implementation stop conditions.
   - Formulate a Phase A architectural plan and obtain owner approval before starting any code modifications.

6. **"What is the exact repository/branch/SHA starting point?"**
   - **Repository**: `sohrabinia/YarTrader.Operator`
   - **Branch**: `main` (or tracking branch `jules-7812311489395922734-bf1f3ed5`)
   - **HEAD SHA**: `e94287aa77a48eee8be18a36329ec9b4a848821e`

---
