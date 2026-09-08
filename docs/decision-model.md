# YarOperator Decision Model

## Decision Pipeline

Every goal or action request processed by YarOperator flows sequentially through the following pipeline:

```
Goal
 ↓
Context (Load workspace/durable context)
 ↓
Risk Evaluation (Assess impact, reversibility, sensitivity)
 ↓
Policy Check (PolicyEngine & ApprovalManager check)
 ↓
Plan (DAG step decomposition)
 ↓
Execution (Controlled Tool/Adapter invocation)
 ↓
Verification (Output validation & secret redaction)
 ↓
Report (Audit logging & owner report)
```

## Action Criteria

### 1. Act Automatically

- Action is explicitly classified as `SAFE`.
- Operation is read-only, non-destructive, and within Level 0 / Level 1 authority bounds.

### 2. Request Approval

- Action is classified as `APPROVAL_REQUIRED`.
- Operation involves state modification (e.g. Git push, PR creation, form submission, file write).
- Generates SHA-256 parameter fingerprint and waits for single-use owner approval token.

### 3. Refuse

- Action is classified as `BLOCKED` (e.g. payments, CAPTCHA bypass, credential scraping).
- Action is unknown, unclassified, or ambiguous (PolicyEngine fail-closed rule).
- Single-use approval token is expired, consumed, or parameters were mutated post-approval.
