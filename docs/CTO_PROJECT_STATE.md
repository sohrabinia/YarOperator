# YarTrader.Operator — CTO Project State

## 1. Snapshot

- **Repository**: `sohrabinia/YarOperator`
- **Operational Version**: `0.1.0` (defined in `package.json` and `src/index.ts`)
- **Current Baseline HEAD SHA**: `5642da1db274c9c8f1623cafabb35b81eda46a5d`
- **Current Roadmap Position**: **Final Established Objective Boundary — COMPLETED & VERIFIED**
- **System Integrity & Verification Status**:
  - Test Suite: **667 vitest tests passing** across 62 test files (`npm test`)
  - TypeScript Compilation: **0 errors** (`npm run build` / `npm run lint`)
  - Code Formatting: **100% compliant** (`npm run format:check`)
  - Working-Tree State: **Clean**
- **Hard Scope Boundary**: Documentation reconciliation only.

---

## 2. Repository Truth

- **Repository**: `sohrabinia/YarOperator` [FACT]
- **Current Branch**: `main` (tracking `origin/main`) [FACT]
- **HEAD SHA**: `5642da1db274c9c8f1623cafabb35b81eda46a5d` [FACT]
- **origin/main SHA**: `5642da1db274c9c8f1623cafabb35b81eda46a5d` [FACT]
- **Git Divergence State**: **In sync with origin/main** [FACT]
- **Working-Tree State**: Clean (0 uncommitted changes) [FACT]
- **Recent Merged Pull Requests**:
  - PR #51 — Merged [FACT]
  - PR #52 — Merged [FACT]
  - PR #55 — Merged [FACT]
  - PR #56 — Merged [FACT]
  - PR #57 — Merged (`Fix Persian System-Health Intent Resolution`) [FACT]
- **Open Pull Requests**: **0 open PRs** [FACT]
- **Repository Clean Rebuild Origin**: The codebase is a clean sequential rebuild starting at commit `238fe3c` (`phase-0-8.2-stable`), completely decoupled from historical repository Git history (`sohrabinia/YarTrader.Operator` legacy or `sohrabinia/Operator`) [FACT - `docs/adrs/0001-clean-rebuild.md`].

---

## 3. Architecture

### Core Execution Model (`BRAIN ≠ HANDS`)

The central architectural directive of YarOperator is strict separation between reasoning/planning (**Brain**) and tool execution primitives (**Hands**) [FACT - `docs/architecture.md`, `docs/operator-model.md`].
The reasoning engine cannot directly access the operating system, filesystem, network, terminal, or browser. All tool execution must flow through a deterministic, governed execution pipeline [FACT]:

```
Owner -> Identity/Session -> Workspace/Environment -> Brain/Capability Resolution -> Policy -> Approval -> SecureToolEcosystem -> Tool -> Adapter -> Audit/Verification
```

### Implemented Primitives vs Active Production Runtime Paths

To maintain documentation precision, YarOperator explicitly distinguishes implemented capability primitives from active production runtime paths:

- **Implemented Primitives**:
  - `DurableScheduler` (CRON/INTERVAL/ONCE, DST/IANA aware)
  - `ExternalAICoordinator` (bounded delegation, local authority retention)
  - `Durable Operational Memory` & Notification Persistence (`node:sqlite`)
  - Browser, Git, GitHub, Terminal, and Research tools
- **Active Production Runtime Paths**:
  - `HTTP Server` (`OperatorWebServer` on `127.0.0.1:3000`) -> `IdentityStore` / Google OAuth -> `OwnerCommandReceiver` -> `RealWorldAssistant` -> `SQLiteAuditStore`.
  - External AI provider connectivity is not active unless an external provider is explicitly configured.
  - Scheduler execution is decoupled from tool execution.

### Policy Engine

- `PolicyEngine` (`src/core/policy/index.ts`) enforces security policy classification [FACT].
- **Fail-Closed Rule**: Any unknown, unclassified, or ambiguous tool operation defaults immediately to `BLOCKED` [FACT].
- Explicit security precedence: `BLOCKED > APPROVAL_REQUIRED > SAFE` [FACT].

### Resource Registry & Workspace Policy

- Production workspaces managed via `ResourceRegistry` / `ResourceResolver`:
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
- Production registry file `config/resources.production.json` is local, untracked, and intentionally excluded from Git commits.

### Approval Model

- `ApprovalManager` (`src/core/policy/index.ts`) handles single-use human owner approval tokens [FACT].
- Uses **SHA-256 parameter fingerprinting** (`createFingerprint`) to hash `toolId` and canonicalized JSON parameters [FACT].
- Single-use consumption (`consumeApproval`) prevents replay attacks; token status transitions from `PENDING` -> `APPROVED` -> `CONSUMED` or `EXPIRED` [FACT].

### Audit Model

- `AuditEngine` / `AuditManager` / `SQLiteAuditStore` (`src/core/audit/index.ts`) acts as a strictly read-only observer logging operational events [FACT].
- **Secret Redaction**: Automatically sanitizes sensitive parameters matching `PASSWORD`, `SECRET`, `TOKEN`, `KEY`, `COOKIE`, or `BEARER_TOKEN` prior to writing audit logs [FACT].
- Audit logs CANNOT modify `PolicyEngine` rules or self-grant approvals [FACT].

### Authentication & Browser Session Model

- Google OAuth OIDC identity (`m.a.sohrabinia@gmail.com` -> `owner_sohrab`).
- Persistent `IdentityStore` session via HttpOnly `yo_session` cookie.
- Browser chat (`src/web/public/app.js`) interacts with `/api/v1/operator/chat` using `credentials: "same-origin"` with zero `sessionStorage` bearer tokens.
- Programmatic bearer token authentication remains supported for external API consumers.
- Dual cookie + bearer token mismatch fails closed with HTTP 401.

---

## 4. YarTrader Integration Matrix

- **SAFE**:
  - Health check (`/health`)
  - Worker status
  - Logs read
  - Diagnostics
  - Configuration read
  - Trading state read
- **APPROVAL_REQUIRED**:
  - Restart service (`restart_service`)
  - Stop service (`stop_service`)
  - Start service (`start_service`)
  - Configuration write (`config_write`)
- **BLOCKED**:
  - Order placement (`order_place`)
  - Order modification (`order_modify`)
  - Order cancellation (`order_cancel`)
  - LIVE trading enablement (`live_enable`)
  - Trading authority override

_Boundary Assertion_: YarOperator is NOT a trading decision engine or execution authority and CANNOT perform live financial market mutations.

---

## 5. Security Invariants

- **Fail-Closed Default**: Any unknown, unclassified, or ambiguous tool request defaults to `BLOCKED`.
- **Workspace Path Containment**: `ResourceResolver` verifies target paths resolve strictly within authorized workspace roots, preventing path traversal or symlink escapes.
- **Single-Use Approval Fingerprints**: SHA-256 parameter hashes protect approval tokens against parameter tampering and replay attacks.
- **Secret Redaction**: Audit logs sanitize credentials, cookies, and tokens.
- **Web Runtime Binding**: Bound to `127.0.0.1:3000` with 1 MiB streaming body limits and IIS reverse proxy rewrite rules (`web.config`).

---

## 6. Verification Evidence Baseline

- `npm test` → 62 test files, 667 tests passed.
- `npm run build` → PASS (0 errors).
- `npm run lint` → PASS (0 errors).
- `npm run format:check` → PASS (100% Prettier compliant).
- Runtime Verification:
  - Service: Running
  - Port 3000: Listening
  - `/health`: HTTP 200 / HEALTHY
  - `/readiness`: HTTP 200 / READY
  - `/Operator`: HTTP 200 (Standalone YarOperator frontend)
  - Google authenticated session: Active
  - Browser command `وضعیت سیستم را بررسی کن`: COMPLETED

---

## 7. CTO Handoff for Future Sessions

1. **"Where are we?"**
   - We are at the final closure boundary for YarOperator.
   - Main branch SHA is `5642da1db274c9c8f1623cafabb35b81eda46a5d`.
   - Open PR count is 0.

2. **"What has been verified?"**
   - The entire test suite (62 test files, 667 tests) passes cleanly (`npm test`).
   - Build, lint, and format checks pass with 0 errors.

3. **"What is the exact repository baseline SHA?"**
   - `5642da1db274c9c8f1623cafabb35b81eda46a5d`
