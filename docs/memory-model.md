# YarOperator Memory Model

## Purpose

YarOperator Memory Engine stores contextual knowledge, workspace rules, past decisions, and operational experiences to enable informed decision-making without turning the operator into an unconstrained data dumping ground.

## Memory Types

1. **SHORT Memory**: Session-level short-term context (e.g., current task focus, active discussion context).
2. **WORKSPACE Memory**: Workspace-specific knowledge (e.g., stack preferences, architecture decisions for YarTrader or Amlakbashi).
3. **DECISION Memory**: Records capturing the "why" behind choices (`decision`, `reason`, `alternatives`, `outcome`, `lesson`).
4. **EXPERIENCE Memory**: Operational learnings (e.g., cross-platform test fixes, error recovery patterns).

## Workspace Isolation

Memory records retain optional `workspaceId` tags. Memory queries scoped to a specific workspace NEVER leak into or return records belonging to other workspaces.

## Security Governance Boundaries

- Memory Engine stores knowledge; it DOES NOT execute tools.
- Memory CANNOT grant policy approvals, bypass `PolicyEngine`, or mutate authorization rules.
