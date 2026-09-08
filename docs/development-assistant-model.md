# YarOperator Development Assistant Model

## Purpose

The Development Assistant Mode allows YarOperator to coordinate, structure, and track development workflows as a technical proxy without bypassing human owner approvals or executing unmonitored external code.

## Development Task Lifecycle

1. **CREATED**: Task formulated from goal with initial workspace and risk assessment.
2. **PLANNED**: Broken down into structured DAG steps and requirements.
3. **ASSIGNED**: Matched with candidate worker agent capabilities (e.g. Jules, Claude, Gemini).
4. **IN_PROGRESS**: Executing under governed tool execution pipeline.
5. **REVIEW**: Code changes, tests, and diffs audited by owner or reviewer.
6. **COMPLETED**: Quality gates pass (tests, build, lint, diff) and task finalized.
7. **FAILED**: Execution failure recorded for self-audit and experience memory.

## Human Control & Security Boundaries

- YarOperator structures tasks, suggests candidate agent assignments, and checks test/build results.
- YarOperator CANNOT autonomously grant security approvals, attach unverified external AI agents with direct privileges, or perform sensitive remote merges without owner approval.
