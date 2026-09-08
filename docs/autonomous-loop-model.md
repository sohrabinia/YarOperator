# YarOperator Autonomous Development Loop Architecture

## Workflow Architecture

```
OWNER GOAL
↓
YarOperator
↓
Understand / Analyze
↓
Create Development Task
↓
Identify Required Capability
↓
Select Suitable Agent (AgentRegistry)
↓
Create Execution Scope
↓
Assign Agent
↓
Agent uses permitted Tools (SecureToolEcosystem)
↓
Execute in permitted Environment (EnvironmentManager)
↓
Test & Build
↓
Preview Execution (PreviewManager)
↓
Compare with Baseline (BaselineManager)
↓
Regression Detection (RegressionEngine)
↓
Acceptance Evaluation (AcceptanceEngine)
↓
PASS / FAIL
↓
Bounded Safe Retry
↓
Audit (AuditManager)
↓
Notify Owner (NotificationManager)
```

## Security Invariants

- `BLOCKED > APPROVAL_REQUIRED > SAFE` remains strictly authoritative.
- Autonomous loops run within bounded retry limits and execution scope boundaries.
- No Agent or tool can self-grant security approvals or bypass `PolicyEngine`.
