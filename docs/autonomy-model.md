# YarOperator Controlled Autonomy Model

YarOperator implements controlled autonomy governed by explicit risk tiers and human oversight boundaries.

## Risk Factors

1. **Impact**: Potential scope of state modification (local file vs. remote system).
2. **Reversibility**: Ease of undoing the operation (git commit vs. remote deployment).
3. **Confidence**: Algorithmic certainty in task parameters and outputs.
4. **Sensitivity**: Data classification (public research vs. private credentials/audit logs).

## Autonomy Tiers

### Low Risk: Automatic Execution

- **Triggers**: Read-only research, lint checks, test runs, status queries.
- **Behavior**: YarOperator executes automatically, records audit event, and logs output.

### Medium Risk: Execute + Report or Approval

- **Triggers**: Workspace file edits, branch creation, local test builds.
- **Behavior**: Executes under governed bounds, redacting secrets, and immediately reports summary to owner.

### High Risk: Mandatory Owner Approval

- **Triggers**: Remote Git pushes, PR creation/merges, authenticated form submissions, policy adjustments.
- **Behavior**: Requires explicit single-use approval token from owner before execution.
