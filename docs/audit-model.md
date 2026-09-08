# YarOperator Audit Engine Model

## Observability Purpose

The Audit Engine provides complete behavior observability and self-audit traces for YarOperator actions, decisions, task progressions, and execution outcomes without granting autonomous permission modification powers.

## Audit Event Lifecycle

1. **TASK_CREATED**: Logged upon initial task/goal reception.
2. **DECISION_MADE**: Captures choice rationale (`decision`, `reason`, `alternatives`, `result`).
3. **ACTION_STARTED**: Recorded before tool/adapter execution.
4. **ACTION_COMPLETED**: Recorded on successful execution with sanitized outputs.
5. **ACTION_FAILED**: Captures execution errors or timeouts.
6. **REVIEW_COMPLETED**: Logged upon self-audit or owner verification review.

## Security Governance Boundaries

- The Audit Engine is strictly an OBSERVER.
- Audit records CANNOT modify `PolicyEngine` rules, self-grant approvals, or bypass security boundaries.
- Sensitive credentials, secrets, tokens, and passwords are redacted prior to audit event recording.
