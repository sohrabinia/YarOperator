# YarOperator Durable Scheduler Model (Phase 8.2)

## Purpose

The **Durable Scheduler** (`DurableScheduler`) is a persistent scheduling primitive responsible for registering, persisting, and evaluating when schedules are due.

It determines **when work is due**, but strictly **does not execute the work**. Execution is decoupled and delegated to downstream engine consumers.

## Core Contract & Lifecycle

### Schedule Definition & Record

A schedule record consists of:

- `id`: Unique schedule identifier.
- `type`: Schedule trigger type (`ONCE`, `INTERVAL`, `CRON`).
- `nextRunAtUtc`: Calculated next execution timestamp (ISO 8601).
- `status`: Lifecycle state (`SCHEDULED`, `DUE`, `COMPLETED`, `CANCELLED`).
- `timezone`: Schedule timezone (defaults to `UTC`).
- `payload`: Optional JSON payload data (never executable code).
- `enabled`: Boolean status flag.

### Lifecycle Transitions

```
[createSchedule] -> SCHEDULED -> (nextRunAt <= atTime) -> DUE -> COMPLETED / CANCELLED
```

1. **`SCHEDULED`**: Active schedule registered in durable storage awaiting due time.
2. **`DUE`**: Schedule evaluated where `nextRunAtUtc <= suppliedTime`.
3. **`COMPLETED`**: Terminal state marked via `completeSchedule(id)`.
4. **`CANCELLED`**: Terminal state marked via `cancelSchedule(id)`.

## Due Semantics

Due evaluation is deterministic and explicitly time-supplied:

```ts
getDueSchedules(atTime: Date): ScheduleRecord[]
```

- Returns all active enabled schedules where `status = 'SCHEDULED'` and `nextRunAtUtc <= atTime.toISOString()`.
- Deterministic ordering: `nextRunAtUtc ASC, createdAt ASC, id ASC`.
- Tests must use explicit timestamps rather than real-time wall-clock waits or sleeps.

## Storage & Durability Boundary

Schedules are stored in local SQLite (`node:sqlite` `DatabaseSync`) within the `schedules` table. When `DurableScheduler` is closed and re-instantiated against the same database path, all schedules and statuses are preserved intact.

## Boundaries & Explicit Out-of-Scope Items

- **NO Retry or Backoff** (Phase 8.3)
- **NO Crash Recovery or Resume** (Phase 8.4)
- **NO Autonomous Execution Loop or Polling Daemon** (Phase 8.5)
- **NO Payload Code Execution**: Payload is purely passive JSON data (`eval` or dynamic execution is strictly prohibited).
- **NO Distributed Coordination**: Single-node deterministic local SQLite storage.
