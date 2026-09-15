# Contributing & Development Governance Rules

This document establishes mandatory operational rules and procedures for developers and automated AI agents contributing to **YarOperator**.

---

## 1. Mandatory Development Rules

1. **Authoritative State Reference**: `PROJECT_STATE.md` at the repository root is the single, authoritative current-state reference for YarOperator.
2. **Pre-Task State Inspection**: Before starting any task, an agent or developer must inspect `PROJECT_STATE.md` to verify the current architecture, baseline, and roadmap boundary.
3. **Co-Updating State**: Any change that materially alters the project state, capabilities, or completed phases must update `PROJECT_STATE.md` in the exact same Pull Request.
4. **Honest Handoff & Status**: An incomplete, degraded, or blocked task must never be recorded or reported as completed.
5. **Agent Reports Are Not Evidence**: Agent reports or textual summary claims are never sufficient evidence by themselves.
6. **Objective Evidence Requirement**: Task completion strictly requires verified Git status/SHA, clean diffs, passing unit/integration tests, and successful build, lint, and formatting checks.
7. **Strict Scope Control**: Agents must not expand task scope, refactor unrelated code, or introduce unnecessary dependencies without explicit authorization from the Owner/CTO.
8. **Boundary Preservation**: Existing security, authority, and architectural boundaries (e.g. `BRAIN ≠ HANDS`, `PolicyEngine`, `WorkspacePolicyManager`) must never be bypassed for convenience.
9. **Anti-Duplication Principle**: No duplicate architecture models, parallel schedulers, memory frameworks, or redundant documentation systems may be introduced.
10. **Fail-Closed Scope Stop**: If requested work cannot be completed within authorized scope, the agent must stop and report the blocker rather than silently extending scope.

---

## 2. Agent Execution Workflow

Every AI agent or automated worker must strictly follow this execution loop:

```text
READ STATE
    ↓
VERIFY BASE
    ↓
DO ONLY AUTHORIZED SCOPE
    ↓
IMPLEMENT
    ↓
TEST
    ↓
VERIFY GIT / DIFF / SHA
    ↓
UPDATE PROJECT_STATE IF STATE CHANGED
    ↓
FINAL REPORT
```

### Execution Steps Breakdown

1. **READ STATE**: Inspect `PROJECT_STATE.md` and `AGENTS.md` to understand current capabilities and boundaries.
2. **VERIFY BASE**: Confirm the actual local and remote Git baseline SHA (`git status`, `git log`).
3. **DO ONLY AUTHORIZED SCOPE**: Restrict changes strictly to the explicitly approved plan and scope.
4. **IMPLEMENT**: Make clean, minimal code or governance modifications.
5. **TEST**: Execute the full repository test suite (`npm test`).
6. **VERIFY GIT / DIFF / SHA**: Check `git status --short`, `git diff --stat`, `git diff --check`, and ensure build (`npm run build`), linting (`npm run lint`), and formatting (`npm run format:check`) pass.
7. **UPDATE PROJECT_STATE IF STATE CHANGED**: If capabilities, completed phases, or Git baselines changed, update `PROJECT_STATE.md` in the same commit/PR.
8. **FINAL REPORT**: Produce an objective forensic report containing actual SHA, diff summary, and command outputs.
