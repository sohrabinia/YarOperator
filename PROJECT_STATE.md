# YarOperator — Project State

## 1. Current Identity

- **Repository**: `sohrabinia/YarOperator`
- **Operational Version**: `0.1.0` (defined in `package.json` and `src/index.ts`)
- **System Purpose**: Independent Personal AI Operator foundation with strict security boundaries, durable operational memory (`node:sqlite`), intent classification (`Brain` contract), and scheduling capabilities.
- **Owner Identity**: `owner_sohrab` (`m.a.sohrabinia@gmail.com`)
- **Target Workspace**: `yartrader` (`workspaceId: "yartrader"`)

## 2. Current Architecture

- **BRAIN ≠ HANDS**: Reasoning/planning (Brain) is strictly separated from execution tool primitives (Hands). The reasoning engine cannot directly access the OS, filesystem, network, terminal, or browser.
- **Governed Execution Pipeline**:
  `Owner -> Identity/Session -> Workspace/Environment -> Brain/Capability Resolution -> Policy -> Approval -> SecureToolEcosystem -> Tool -> Adapter -> Audit/Verification`
- **Intent Boundary & Brain Contract**: `DeterministicBrain` implements `Brain` contract (`BrainInput`, `BrainResult`, `BrainIntent`, `BrainRule`, `BrainProvider`, `Brain`) in `src/core/contracts/index.ts` to deterministically classify inputs into `CONVERSATION`, `ACTION`, or `AMBIGUOUS`. Conversational requests route cleanly with `resolvedCapability: "conversation"` without invoking tools or `PolicyEngine`.
- **Policy Engine & Risk Levels**: Security risk tiers:
  - `SAFE`: Read-only, non-destructive operations.
  - `APPROVAL_REQUIRED`: State-modifying operations requiring single-use SHA-256 parameter-fingerprinted approval tokens.
  - `BLOCKED`: Forbidden high-risk actions.
  - Security Precedence Rule: `BLOCKED > APPROVAL_REQUIRED > SAFE`. Fail-closed by default.
- **Workspace Containment**: `WorkspacePolicyManager` and `ResourceRegistry`/`ResourceResolver` enforce strict workspace root path boundaries (`validateRoot`) and tool scoping (`validateTool`) without implicit `process.cwd()` fallback.
- **Durable Operational Memory & Scheduler Primitives**: Native Node.js SQLite (`node:sqlite`) backed `OperationalStateStore` and `DurableScheduler` supporting CRON/INTERVAL/ONCE jobs with IANA timezone and DST awareness.
- **Web Runtime & Authentication Model**: Express server `OperatorWebServer` bound by default to `127.0.0.1:3000` with Google OAuth / OIDC owner authentication (`m.a.sohrabinia@gmail.com` -> `owner_sohrab`), persistent `IdentityStore` session via HttpOnly `yo_session` cookie, same-origin credentials for browser chat (no `sessionStorage` bearer token), programmatically supported bearer tokens for API access, IIS reverse proxy header rewrite rules (`web.config`), and YarTrader Admin route integration (`/fa/admin/operator` & `/admin/operator`).

## 3. Current Capabilities

- **Intent Boundary & Conversation Routing**: Deterministic classification of conversational inputs bypassing tool execution pipelines.
- **Workspace Boundary Enforcement**: Fail-closed path traversal prevention and tool permission validation via `ResourceRegistry` and `ResourceResolver`.
- **Approval Token Management**: Single-use token generation with SHA-256 parameter fingerprinting for tamper resistance.
- **Audit Logging**: Automatic redaction of secrets, tokens, cookies, and keys in `SQLiteAuditStore` before writing audit logs.
- **Execution Tools**: `TerminalTool`, `BrowserTool` (fails closed as `NOT_CONFIGURED` if Playwright driver is missing), `ResearchTool`, `GitTool`, `JulesWorkerAdapter`, `YarTraderTool` (bounded HTTP probe, strictly blocked trading operations).
- **Implemented Primitives vs Active Production Runtime Paths**:
  - _Implemented Primitives_: `DurableScheduler`, `ExternalAICoordinator`, `Durable Operational Memory`, notification persistence, Browser/Git/GitHub/Terminal/Research tools.
  - _Active Production-Wired Runtime Paths_: HTTP Web Server -> Identity/Auth -> OwnerCommandReceiver -> RealWorldAssistant -> SQLite Audit Store. External AI provider connectivity is not active unless an external provider is explicitly configured. Scheduler execution remains decoupled from tool execution.
- **Operator Goal API**: Natural language goal resolution and tool capability matching in `OperatorApi`.
- **Web Runtime & UI**: Express server hosting the standalone YarOperator web UI (`src/web/public/`) with dark executive styling and Persian RTL typography.

## 4. Resource Registry Model

- **`yartrader` workspace**:
  - Repository: `sohrabinia/YarTrader`
  - Root: `C:\Projects\YarTrader`
  - Environment: `env_yartrader`
  - Allowed service: `yartrader_api`
  - Allowed HTTP origin: `https://api.yartrader.com`
- **`ws_default` workspace**:
  - Repository: `sohrabinia/YarOperator`
  - Root: `C:\Projects\Operator`
  - Environment: `env_ws_default`
  - Allowed service: `operator_service`
  - Allowed HTTP origin: `http://127.0.0.1:3000`
- _Note_: Production environment configuration resides in local untracked `config/resources.production.json` and is explicitly omitted from Git tracking.

## 5. YarTrader Boundary Matrix

- **SAFE**: Health, worker status, logs, diagnostics, config read, trading state.
- **APPROVAL_REQUIRED**: Restart service, stop service, start service, configuration write.
- **BLOCKED**: Order placement, order modification, order cancellation, LIVE enablement, trading authority override.

## 6. Completed Work & Roadmap Status

- **Phases 0–8.2 Completed**: Architecture, Execution Engine, Terminal Operator, Browser Operator, Web Research Operator, Policy Engine & Approvals, Git/GitHub + Jules Worker, Workflow Engine, Durable Operational Memory, Durable Scheduler.
- **PR #51**: Merged
- **PR #52**: Merged
- **PR #55**: Merged
- **PR #56**: Merged
- **PR #57**: Merged (Fix Persian System-Health Intent Resolution)
- **Current Open PR Count**: `0`

## 7. Known Limits / Operational Boundaries

- **Phase 8.3+**: Retry lifecycle, continuation, and subsequent roadmap phases remain deferred.
- **Browser Driver Dependency**: `BrowserTool` requires Playwright binaries on host; fails closed safely as `NOT_CONFIGURED` if absent.
- **Mobile Reverse Proxy Verification**: IIS ARR reverse proxy mobile routing under custom subdomains requires live infrastructure verification.

## 8. Architectural Invariants

- **BRAIN ≠ HANDS**: Reasoning and tool execution are strictly decoupled; Brain cannot directly invoke OS primitives without policy enforcement.
- **Fail-Closed Security Boundary**: Unknown tools, unclassified actions, or paths escaping authorized workspace roots default immediately to `BLOCKED`.
- **Independent Brain Contract**: Standardized contract interfaces (`BrainInput`, `BrainResult`, `BrainIntent`, `BrainRule`, `BrainProvider`, `Brain`) in `src/core/contracts/index.ts` abstract intent classification without coupling to PolicyEngine or Orchestrator.
- **Deterministic Conversation Routing**: Conversational inputs resolve to `conversation` capability and bypass tool execution and PolicyEngine entirely.
- **Native SQLite Persistence**: Node native `node:sqlite` for zero-dependency operational state and durable scheduling across restarts.
- **Trading Authority Limitation**: YarOperator is not a trading decision engine or execution authority; live trading and order mutations are strictly `BLOCKED`.
- **Credentials Handling**: Client credentials remain outside model context and are processed strictly server-side.

## 9. Current Git Baseline & Verification State

- **Repository Identity**: `sohrabinia/YarOperator`
- **Base / Tracking Branch**: `main`
- **HEAD SHA**: `5642da1db274c9c8f1623cafabb35b81eda46a5d`
- **Origin Main SHA**: `5642da1db274c9c8f1623cafabb35b81eda46a5d`
- **Verification Metrics**:
  - Test Suite: **62 test files, 667 vitest tests passed** (`npm test`).
  - Build Check: **0 TypeScript errors** (`npm run build`).
  - Lint Check: **0 linting errors** (`npm run lint`).
  - Format Check: **100% compliant** (`npm run format:check`).
  - Service Endpoints: `/health` (HTTP 200 / HEALTHY), `/readiness` (HTTP 200 / READY), `/Operator` (HTTP 200).
