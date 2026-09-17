# YarOperator — Project State

## 1. Current Identity

- **Repository**: `sohrabinia/YarOperator`
- **Operational Version**: `0.1.0` (defined in `package.json` and `src/index.ts`)
- **System Purpose**: Independent Personal AI Operator foundation with strict security boundaries, durable operational memory (`node:sqlite`), intent classification (`Brain` contract), and scheduling capabilities.
- **Owner Identity**: `owner_sohrab` (`m.a.sohrabinia@gmail.com`)
- **Target Target Workspace**: `yartrader` (`workspaceId: "yartrader"`)

## 2. Current Architecture

- **BRAIN ≠ HANDS**: Reasoning/planning (Brain) is strictly separated from execution tool primitives (Hands). The reasoning engine cannot directly access the OS, filesystem, network, terminal, or browser.
- **Governed Execution Pipeline**:
  `WorkflowEngine -> ExecutionEngine -> PolicyEngine -> ApprovalManager -> ToolRegistry -> Tool -> Adapter`
- **Intent Boundary & Brain Contract**: `IntentBoundary` implements `Brain` contract (`BrainInput`, `BrainResult`, `BrainIntent`, `BrainRule`, `BrainProvider`, `Brain`) in `src/core/contracts/index.ts` to deterministically classify inputs into `CONVERSATION` or `ACTION`. Conversational requests route cleanly with `resolvedCapability: "conversation"` without invoking tools or `PolicyEngine`.
- **Policy Engine & Risk Levels**: Security risk tiers:
  - `SAFE`: Read-only, non-destructive operations.
  - `APPROVAL_REQUIRED`: State-modifying operations requiring single-use SHA-256 parameter-fingerprinted approval tokens.
  - `BLOCKED`: Forbidden high-risk actions.
  - Security Precedence Rule: `BLOCKED > APPROVAL_REQUIRED > SAFE`. Fail-closed by default.
- **Workspace Containment**: `WorkspacePolicyManager` enforces strict workspace root path boundaries (`validateRoot`) and tool scoping (`validateTool`) without implicit `process.cwd()` fallback.
- **Durable Operational Memory & Scheduler**: Native Node.js SQLite (`node:sqlite`) backed `OperationalStateStore` and `DurableScheduler` supporting CRON/INTERVAL/ONCE jobs with IANA timezone and DST awareness.
- **Web Runtime & Identity**: Express server `OperatorWebServer` bound to `127.0.0.1:3000` with OIDC Google Auth (`m.a.sohrabinia@gmail.com` -> `owner_sohrab`), IIS reverse proxy header rewrite rules (`web.config`), and YarTrader Admin route integration (`/fa/admin/operator` & `/admin/operator`).

## 3. Current Capabilities

- **Intent Boundary & Conversation Routing**: Deterministic classification of conversational inputs bypassing tool execution pipelines.
- **Workspace Boundary Enforcement**: Fail-closed path traversal prevention and tool permission validation.
- **Approval Token Management**: Single-use token generation with SHA-256 fingerprinting for parameter tamper resistance.
- **Audit Logging**: Automatic redaction of secrets, tokens, cookies, and keys before writing audit logs.
- **Execution Tools**: `TerminalTool`, `BrowserTool` (fails closed as `NOT_CONFIGURED` if driver is missing), `ResearchTool`, `GitTool`, `JulesWorkerAdapter`.
- **Durable Operational Persistence**: Process-restart resilient state storage via Node native `node:sqlite`.
- **Durable Scheduler**: Atomic transaction-based occurrence claiming with duplicate execution protection.
- **Operator Goal API**: Natural language goal resolution and tool capability matching in `OperatorApi`.
- **Web Runtime & UI**: Express server hosting the web UI and Google OIDC session management.

## 4. Completed Work

- **Phase 0**: Architecture, Governance & Bootstrap (`BootstrapEngine`, `tests/bootstrap.test.ts`)
- **Phase 1**: Operator Core / Execution Engine (`ExecutionEngine`, `tests/engine.test.ts`)
- **Phase 2**: Terminal Operator (`TerminalTool`, `tests/terminal.test.ts`)
- **Phase 3**: Browser Operator (`BrowserTool`, `tests/browser.test.ts`)
- **Phase 4**: Web Research Operator (`ResearchTool`, `tests/research.test.ts`)
- **Phase 5**: Approval & Policy Engine (`PolicyEngine`, `ApprovalManager`, `tests/policy.test.ts`)
- **Phase 6**: Git / GitHub + Jules Worker (`GitTool`, `JulesWorker`, `AGENTS.md`, `tests/git.test.ts`)
- **Phase 7**: Workflow Engine (`WorkflowEngine`, `tests/workflow.test.ts`)
- **Phase 8.1**: Durable Operational Memory (`OperationalStateStore`, `tests/durable_operational_memory.test.ts`)
- **Phase 8.2**: Durable Scheduler (`DurableScheduler`, `tests/durable_scheduler.test.ts`, `tests/scheduler_remediated.test.ts`)
- **PR #19**: Fix YarOperator Conversation / Action Intent Boundary (`Brain` contract, `IntentBoundary`, `OwnerCommandReceiver`, `tests/owner_command_bootstrap.test.ts`)
- **M1 First Deterministic Brain Intelligence**: Implemented `DeterministicBrain`, `Normalizer`, and `OperatorKnowledgeBase` in `src/core/brain/index.ts` and contracts in `src/core/contracts/index.ts` for deterministic CONVERSATION vs ACTION vs AMBIGUOUS classification, Persian entity alias resolution (YarTrader, YarOperator, Amlakbashi), action vocabulary matching, and greeting replies (`tests/brain.test.ts`).

## 5. In-Progress Work

- **M1 Completed**: Ready for review and PR against `main`.

## 6. Known Gaps / Blockers

- **Phase 8.3+**: Phase 8.3 (Durable Retry & Continuation) and subsequent roadmap phases have not been started.
- **Not Implemented in M1**: LLM/AI Provider integration, Brain -> Orchestrator execution integration (scheduled for M2), Browser automation, Vector/Semantic Memory.
- **Browser Driver Dependency**: `BrowserTool` requires Playwright binaries installed on host to execute browser automation; fails closed safely as `NOT_CONFIGURED` if absent.
- **Mobile Reverse Proxy Verification**: IIS ARR reverse proxy mobile routing under custom subdomains requires live infrastructure verification (AGENTS.md Stop Condition 8).

## 7. Architectural Decisions

- **Clean Rebuild Origin**: Clean sequential rebuild starting from commit `238fe3c` (`phase-0-8.2-stable`), completely decoupled from legacy history (`docs/adrs/0001-clean-rebuild.md`).
- **BRAIN ≠ HANDS**: Reasoning and tool execution are strictly decoupled; Brain cannot directly invoke OS primitives without policy enforcement.
- **Fail-Closed Security Boundary**: Unknown tools, unclassified actions, or paths escaping authorized workspace roots default immediately to `BLOCKED`.
- **Independent Brain Contract**: Standardized contract interfaces (`BrainInput`, `BrainResult`, `BrainIntent`, `BrainRule`, `BrainProvider`, `Brain`) in `src/core/contracts/index.ts` abstract intent classification without coupling to PolicyEngine or Orchestrator.
- **Deterministic Conversation Routing**: Conversational inputs resolve to `conversation` capability and bypass tool execution and PolicyEngine entirely.
- **Native SQLite Persistence**: Node native `node:sqlite` for zero-dependency operational state and durable scheduling across restarts.
- **YarTrader Identity Integration**: YarTrader serves as authoritative identity provider; accessing `/fa/admin/operator` or `/admin/operator` routes to `OperatorWebServer` consuming authenticated YarTrader Admin identity without requiring a separate Operator login or manual Bearer token.

## 8. Forbidden / Out-of-Scope Areas

- **Runtime Behavior Changes**: Bypassing or modifying PolicyEngine, WorkspacePolicy, ApprovalManager, or core runtime security logic.
- **Vector / Semantic Memory**: Adding vector databases, semantic RAG, or embedding stores in Phase 8.
- **Payload Code Execution**: Direct code execution inside scheduler payloads.
- **Client-Side Selection**: Client-side or UI-based tool, agent, or provider selection bypassing backend policy rules.
- **Trading Domain Duplication**: Duplicating YarTrader financial domain trading code inside YarOperator.
- **Scope Creep**: Expanding task scope or silently adding new dependencies or frameworks without explicit authorization.

## 9. Current Git Baseline

- **Repository Identity**: `sohrabinia/YarOperator`
- **Base Branch**: `main` (tracking branch `jules-14175115289222590379-5c0583f8`)
- **HEAD SHA**: `f5428bf76da1e95d9bbe7a04a2cadf7c7a481f42`
- **Origin Main SHA**: `f5428bf76da1e95d9bbe7a04a2cadf7c7a481f42`
- **Latest Verified Commit**: `f5428bf` Merge pull request #19 from sohrabinia/jules-8574882851843623838-e8b8dc10 ("Fix YarOperator Conversation / Action Intent Boundary")

## 10. Verification Rules

- **Agent Reports Are Not Evidence**: Claims in agent reports or chat comments are insufficient on their own.
- **Mandatory Completion Requirements**:
  1. Git working tree status verified clean (`git status --short`).
  2. Git diff verified clean and focused (`git diff --stat`, `git diff --check`, `git diff`).
  3. Real unit/integration test suite passed (`npm test` — 35 files, 185 tests passing).
  4. TypeScript compilation passed (`npm run build`).
  5. TypeScript linting check passed (`npm run lint`).
  6. Prettier format check passed (`npm run format:check`).

## 11. Next Allowed Work

- Scope is strictly governed by `PROJECT_STATE.md` and approved Phase A architectural plans.
- **Next Official Roadmap Target**: Phase 8.3 (Durable Retry & Continuation) or Phase 9 (Identity Migration) as directed by CTO/Owner.
- Any work must be explicitly authorized and requires prior owner approval on plan and architecture before execution.

## 12. Change History

- **Date**: 2026-09-15
  **Change / PR**: PR #19 (Merge commit `f5428bf76da1e95d9bbe7a04a2cadf7c7a481f42`)
  **Status**: COMPLETED & MERGED
  **Purpose**: Fix YarOperator Conversation / Action Intent Boundary
  **Verified SHA**: `f5428bf76da1e95d9bbe7a04a2cadf7c7a481f42`
  **Short Result**: Established `Brain` contract interface in `src/core/contracts/index.ts` and connected `IntentBoundary` in `OwnerCommandReceiver` to classify conversation inputs without calling tools or PolicyEngine.
