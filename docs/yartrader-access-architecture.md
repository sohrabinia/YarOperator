# YarOperator → YarTrader Access Architecture & Security Boundary Contract

## 1. Architectural Access Pipeline

All operational requests initiated by the Owner targeting YarTrader capabilities follow a strict, uni-directional, 11-stage authorization and execution pipeline:

```
[Owner]
  │
  ▼
[YarOperator Presentation / Chat Layer]
  │ (Bearer Session Token)
  ▼
[M12 Authentication & Identity Gate]
  │ (Session -> User -> Active Membership -> Resource Resolver)
  ▼
[Deterministic Brain / Task Executor]
  │ (Capability Resolution & Tool Binding)
  ▼
[PolicyEngine] ──► (SAFE / APPROVAL_REQUIRED / BLOCKED)
  │
  ├─► BLOCKED ──► [Fail Closed Deny]
  ├─► APPROVAL_REQUIRED ──► [ApprovalManager Single-Use Token Check]
  │                           │
  │                           └─► Unapproved / Replayed ──► [Fail Closed Deny]
  ▼
[SecureToolEcosystem / DiagnosticWorker]
  │ (Bounded HttpProbe / SystemHealthProvider)
  ▼
[YarTrader Adapter / API Endpoint]
  │
  ▼
[AuditManager Log & Result Verification]
```

---

## 2. Access Level Matrix

| Capability / Operation          | Access Level | Type  | Policy Rule         | Approval Required   | Credential Location  | Audit Severity | Fail-Closed Behavior |
| :------------------------------ | :----------- | :---- | :------------------ | :------------------ | :------------------- | :------------- | :------------------- |
| **YarTrader Health Probe**      | Read-Only    | Read  | `SAFE`              | No                  | Bounded HTTP / Probe | LOW            | Return `UNAVAILABLE` |
| **Worker Status / State**       | Read-Only    | Read  | `SAFE`              | No                  | Bearer Session Token | LOW            | Return `UNAVAILABLE` |
| **Operational Logs / Errors**   | Read-Only    | Read  | `SAFE`              | No                  | Bearer Session Token | LOW            | Return `UNAVAILABLE` |
| **System Diagnostics**          | Read-Only    | Read  | `SAFE`              | No                  | Bearer Session Token | LOW            | Return `UNAVAILABLE` |
| **Configuration Read**          | Read-Only    | Read  | `SAFE`              | No                  | Bearer Session Token | LOW            | Return `UNAVAILABLE` |
| **Trading State / DEMO Read**   | Read-Only    | Read  | `SAFE`              | No                  | Bearer Session Token | LOW            | Return `UNAVAILABLE` |
| **Restart Service / Worker**    | Controlled   | Write | `APPROVAL_REQUIRED` | Yes (Single-Use)    | Server Process Env   | MEDIUM         | DENY Execution       |
| **Stop / Start Service**        | Controlled   | Write | `APPROVAL_REQUIRED` | Yes (Single-Use)    | Server Process Env   | HIGH           | DENY Execution       |
| **Configuration Write**         | Controlled   | Write | `APPROVAL_REQUIRED` | Yes (Single-Use)    | Server Process Env   | HIGH           | DENY Execution       |
| **Deployment / Worker Patch**   | Controlled   | Write | `APPROVAL_REQUIRED` | Yes (Single-Use)    | Server Process Env   | HIGH           | DENY Execution       |
| **DEMO Mode Toggle**            | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |
| **LIVE Trading Enablement**     | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |
| **Order Placement / Entry**     | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |
| **Order Modification / Cancel** | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |
| **Risk Configuration Change**   | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |
| **Trading Brain Override**      | Forbidden    | Write | `BLOCKED`           | Permanently Blocked | N/A                  | CRITICAL       | DENY Execution       |

---

## 3. Strict Trading Authority Boundary

### Non-Negotiable Invariants:

1. **Operator ≠ Trading Brain**: YarOperator is an executive assistant and operational orchestrator, NOT a financial analysis or trading decision engine.
2. **Operator ≠ Trading Execution Authority**: YarOperator is strictly forbidden from directly executing, modifying, or cancelling live orders or altering trading parameters.
3. **No Risk Control Override**: YarOperator cannot disable stop-loss, risk limits, position caps, or safety gates on YarTrader.
4. **No LIVE Mode Enablement**: Enabling LIVE trading or shifting operating modes from DEMO to LIVE is permanently `BLOCKED`.

---

## 4. Credential Architecture & Protection Model

1. **Model Context Isolation**: Raw API keys, bearer secrets, database credentials, or private SSH keys MUST NEVER be passed into LLM prompt contexts or model tool payloads.
2. **Tool Result Abstraction**: The LLM model receives strictly sanitized, structured `ToolResult` outputs where all keys and sensitive tokens match `[REDACTED]`.
3. **Server-Side Binding**: Credentials reside exclusively in secure environment variables or OS-managed key stores and are consumed inside native tool adapters.

---

## 5. Fail-Closed Matrix

| Trigger / Failure Scenario         | Expected Security Behavior    | HTTP / Response Code        |
| :--------------------------------- | :---------------------------- | :-------------------------- |
| Missing Authentication Token       | Reject Request                | `401 Unauthorized`          |
| Invalid / Expired Bearer Token     | Reject Request                | `401 Unauthorized`          |
| Non-Member Workspace Context       | Reject Access                 | `403 Forbidden`             |
| YarTrader Service Unavailable      | Fail Closed Gracefully        | Return `UNAVAILABLE` Status |
| Bounded Probe Timeout              | Abort Request & Reader Stream | Return `TIMEOUT` Error      |
| Policy Engine Offline              | Fail Closed Deny              | `500 Internal Server Error` |
| Approval Manager Unavailable       | Fail Closed Deny              | Deny Execution              |
| Replayed / Consumed Approval Token | Block Execution               | `400 Bad Request`           |
| Unknown Tool / Action Request      | Fail Closed Deny              | `BLOCKED` Status            |

---

## 6. Capability Discovery & Accuracy Contract

When queried regarding its capabilities, YarOperator MUST report strictly registered tools and active policy permissions:

- Must explicitly distinguish between **Read-Only** tools (`SAFE`), **Approval-Gated** tools (`APPROVAL_REQUIRED`), and **Forbidden** operations (`BLOCKED`).
- Must reflect real-time service readiness (`HEALTHY`, `DEGRADED`, `UNHEALTHY`, or `UNAVAILABLE`).
- Must NEVER claim trading order execution or live position management capabilities.
