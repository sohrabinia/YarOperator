# Architecture Specification

## BRAIN ≠ HANDS Principle

The reasoning/planning layer (Brain) must never receive unrestricted direct access to OS, filesystem, terminal, browser, or Git.
Execution occurs strictly through explicit controlled tools and adapters monitored by the `PolicyEngine`.

## Execution Pipeline Architecture

`WorkflowEngine -> ExecutionEngine -> PolicyEngine -> ApprovalManager -> ToolRegistry -> Tool -> Adapter`

## Security Classification

1. **SAFE**: Non-destructive operations (read-only research, tests, status checks).
2. **APPROVAL_REQUIRED**: Consequential actions (file modifications, authenticated submissions, git push, PR creation).
3. **BLOCKED**: Forbidden high-risk actions (payments, credential scraping, CAPTCHA bypass, security override).

Precedence: `BLOCKED > APPROVAL_REQUIRED > SAFE`.
