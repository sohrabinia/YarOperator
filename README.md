# YarTrader Operator (`YarTrader.Op`)

Canonical, deterministic general-purpose operator for YarTrader built with strict security boundaries, durable operational memory, and scheduling capabilities.

## Architectural Directives

- **BRAIN ≠ HANDS**: Reasoning/planning (Brain) is strictly separated from execution tools (Hands).
- **Execution Chain**: `WorkflowEngine -> ExecutionEngine -> PolicyEngine -> ApprovalManager -> ToolRegistry -> Tool -> Adapter`
- **Security Boundaries**: Every operation is classified into `SAFE`, `APPROVAL_REQUIRED`, or `BLOCKED`.
- **Durable Memory & Scheduler**: Native Node SQLite-backed state store (`node:sqlite`) and deterministic timezone/DST-aware scheduler.

## Phase Roadmap

- **Phase 0**: Architecture + Governance + Bootstrap
- **Phase 1**: Operator Core / Execution Engine
- **Phase 2**: Terminal Operator
- **Phase 3**: Browser Operator
- **Phase 4**: Web Research Operator
- **Phase 5**: Approval & Policy Engine
- **Phase 6**: Git / GitHub + Jules Worker
- **Phase 7**: Workflow Engine
- **Phase 8.1**: Durable Operational Memory
- **Phase 8.2**: Durable Scheduler

## Development

```bash
npm install
npm test
npm run build
npm run lint
npm run format:check
```
