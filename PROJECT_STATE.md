# YarOperator Project State

## 1. Baseline & Identity

- **Repository**: `sohrabinia/YarOperator`
- **Operational Version**: `0.1.0` (defined in `package.json` and `src/index.ts`)
- **Git Baseline**: `main` @ `f5428bf76da1e95d9bbe7a04a2cadf7c7a481f42` [FACT]
- **Current Position**: PR #19 Merged (Conversation / Action Intent Boundary) [FACT]
- **Governance Rule**: No future phase or task is authorized by `PROJECT_STATE.md` alone. The Owner/CTO must explicitly authorize the next task after reviewing current state and acceptance gates. [FACT]

---

## 2. Verified Capabilities & Architecture

### Intent Boundary (`src/core/owner/index.ts`) [IMPLEMENTED]

- `IntentBoundary.classify` deterministically classifies incoming input text into `CONVERSATION` or `ACTION` prior to capability resolution and policy checks.
- Handled Greetings & Inquiries: `سلام`, `سلام علیکم`, `درود`, `روز بخیر`, `وقت بخیر`, `hello`, `hi`, `hey`, `greetings`, `خوبی؟`, `چطوری؟`, `چه خبر؟`, `ممنون`, `مرسی`, `تشکر`, `چه اقدامی جواب سلام رو بده`.
- Route Behavior:
  - `CONVERSATION`: Immediately returns a conversational response summary (`resolvedCapability: "conversation"`, `resolvedToolId: undefined`, 0 steps executed). Does NOT create a ToolRequest, enter PolicyEngine, or execute tools.
  - `ACTION`: Routes through existing capability resolution, `AgentOrchestrator`, `RealWorldAssistant`, `PolicyEngine`, `ControlledAutonomyEngine`, and `Tool` execution.
- Fallback Behavior: Unrecognized natural language input defaults to `ACTION` and enters capability/tool resolution rather than silently becoming a fake conversation.

### Brain Architecture [PLANNED / ARCHITECTURAL DIRECTION]

- **Status**: `PLANNED / ARCHITECTURAL DIRECTION` (NOT implemented on current `main`).
- **Architectural Direction**: Future Brain Contract interfaces (`BrainInput`, `BrainResult`, `Brain`, `BrainRule`, `BrainProvider`) will form an independent classification layer sitting above `Orchestrator`, `PolicyEngine`, and `Tools/Hands`.
- **Note**: `IntentBoundary` in `src/core/owner/index.ts` is the current deterministic intent classification boundary and does NOT implement `Brain`.

### Core Execution Pipeline (`src/core/`) [IMPLEMENTED]

- `OwnerCommandReceiver` (`src/core/owner/index.ts`): Receives owner input commands, verifies owner identity and workspace context.
- `AgentOrchestrator` (`src/core/orchestrator/index.ts`): Resolves agents and tools based on target capabilities.
- `PolicyEngine` (`src/core/policy/index.ts`): Enforces action safety levels (`SAFE`, `APPROVAL_REQUIRED`, `BLOCKED`).
- `ControlledAutonomyEngine` (`src/core/autonomy/index.ts`): Runs controlled actions under autonomy budgets and workspace policy boundaries.
- `SecureToolEcosystem` (`src/core/tools/index.ts`): Tool registry enforcing `EnvironmentManager` checks and `WorkspacePolicyManager` root path boundaries.

### Durability & Persistence (`src/core/memory/`, `src/core/scheduler/`) [IMPLEMENTED]

- `OperationalStateStore` (`src/core/memory/operational.ts`): SQLite-backed operational memory (`node:sqlite`).
- `DurableScheduler` (`src/core/scheduler/index.ts`): SQLite-backed schedule persistence supporting `CRON`, `INTERVAL`, and `ONCE` types.

### Authentication & Web Runtime (`src/web/`, `src/api/`) [IMPLEMENTED]

- `OperatorWebServer` (`src/web/server.ts`): Localhost-bound Express/Node web server (`127.0.0.1:3000`).
- OIDC Authentication: Google OIDC web authentication authorizing `m.a.sohrabinia@gmail.com` mapped to `owner_sohrab` via HTTP-only session cookies.
- Programmatic API: Bearer token authentication via `OperatorApiHandler` (`src/api/operator.ts`).

---

## 3. Status Summary

| Component                    | Status                              | Location / Reference                            |
| :--------------------------- | :---------------------------------- | :---------------------------------------------- |
| Intent Boundary              | `IMPLEMENTED`                       | `src/core/owner/index.ts`                       |
| Brain Contract               | `PLANNED / ARCHITECTURAL DIRECTION` | Conceptual boundary (Not implemented on `main`) |
| Policy Engine & Approvals    | `IMPLEMENTED`                       | `src/core/policy/index.ts`                      |
| Controlled Autonomy Engine   | `IMPLEMENTED`                       | `src/core/autonomy/index.ts`                    |
| Secure Tool Ecosystem        | `IMPLEMENTED`                       | `src/core/tools/index.ts`                       |
| Durable Operational Memory   | `IMPLEMENTED`                       | `src/core/memory/operational.ts`                |
| Durable Scheduler            | `IMPLEMENTED`                       | `src/core/scheduler/index.ts`                   |
| OIDC & Bearer Auth           | `IMPLEMENTED`                       | `src/web/server.ts`, `src/api/operator.ts`      |
| Semantic Memory / Vector RAG | `NOT IMPLEMENTED`                   | Out of scope                                    |
| External LLM Integration     | `NOT IMPLEMENTED`                   | Out of scope                                    |
