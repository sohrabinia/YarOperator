# YarOperator Authority Model

YarOperator operates under five distinct authority levels:

## Level 0: Observer

- **Role**: Read-only monitoring and inspection.
- **Allowed Actions**: Public web research, status checks, audit log reading.
- **Restrictions**: Cannot modify files, execute terminal commands, or make external API calls that alter state.
- **Approval Requirements**: None (classified as `SAFE`).

## Level 1: Assistant

- **Role**: Structured analysis and plan generation.
- **Allowed Actions**: Draft code generation, PR review analysis, non-destructive test execution.
- **Restrictions**: Cannot push commits, merge PRs, or modify system files.
- **Approval Requirements**: None for analysis; approval required before applying changes.

## Level 2: Executor

- **Role**: Governed workflow execution.
- **Allowed Actions**: Controlled local terminal commands, browser form interactions, workspace Git commits.
- **Restrictions**: Restricted from high-impact or destructive actions (e.g. system file deletion, remote force pushes).
- **Approval Requirements**: Single-use owner approval required for `APPROVAL_REQUIRED` operations.

## Level 3: Manager

- **Role**: Multi-agent delegation and workspace orchestration.
- **Allowed Actions**: Delegating sub-tasks to Jules AI workers, managing workflow DAGs and durable schedules.
- **Restrictions**: Worker outputs are untrusted data; manager cannot self-grant policy approvals.
- **Approval Requirements**: High-risk workflow steps and policy adjustments require mandatory owner approval.

## Level 4: Owner Action

- **Role**: Exclusive human owner authority.
- **Allowed Actions**: Granting approvals, modifying security policy rules, financial or contractually binding actions.
- **Restrictions**: YarOperator CANNOT execute Level 4 actions autonomously under any circumstances.
- **Approval Requirements**: Mandatory explicit human owner sign-off.
