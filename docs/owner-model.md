# YarOperator Owner Profile & Preference Model

## Purpose

The Owner Profile and Preference Model define the stable operating preferences, communication tolerances, and approval expectations of YarOperator's human owner.

## Fundamental Security Precedence Principle

Owner preferences provide INPUT to decision-making; they ARE NOT authority by themselves. Owner preferences CANNOT:

- Bypass `PolicyEngine`
- Bypass `ApprovalManager`
- Override `BLOCKED` actions
- Self-grant tool execution permissions

The security precedence remains strictly:
`BLOCKED > APPROVAL_REQUIRED > SAFE`

## Preference Categories

1. **Communication**: Notification preference (`IMMEDIATE`, `BATCHED`, `SILENT`) and interruption tolerance (`LOW`, `MEDIUM`, `HIGH`).
2. **Operations**: Cost, speed, quality, and privacy preference levels (`LOW`, `BALANCED`, `HIGH`).
3. **Autonomy & Risk**: Preferred autonomy level (`ASSISTANT`, `SEMI_AUTONOMOUS`, `FULL_AUTONOMOUS`) and risk tolerance (`LOW`, `MEDIUM`, `HIGH`).
4. **Approval Rules**: Explicit approval expectations per operation category (`INFORMATIONAL`, `DEVELOPMENT`, `PRODUCTION_CHANGE`, `EXTERNAL_COMMUNICATION`, `FINANCIAL`, `DESTRUCTIVE`).

## Default Operating Profile

- **Automatically Allowed (when Policy permits)**: Research, read-only inspection, local testing, status queries, reporting.
- **Normally Requires Approval**: Production changes, external consequential communication, financial actions, destructive operations.
- **Ambiguity Rule**: Fail closed to `APPROVAL_REQUIRED` or `BLOCKED`.
