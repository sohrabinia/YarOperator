# YarOperator Conceptual Model

## Architectural Principle: Brain ≠ Hands

Reasoning/planning (Brain) must never have direct, unrestricted access to system execution tools (Hands). Execution occurs strictly through explicit, controlled tools and adapters governed by the authoritative PolicyEngine.

## Core Conceptual Layers

1. **Brain (Reasoning & Planning)**
   - Formulates plans, analyzes goals, and determines required tool invocations.
   - Operates within structured contracts and receives untrusted data only through sanitized boundaries.

2. **Memory (Context & State)**
   - Persists operational state, workflow progress, and schedule occurrences across process restarts via native `node:sqlite`.
   - Rejects storage of secrets, tokens, or session credentials.

3. **Policy (Governance & Authority)**
   - Enforces strict security precedence: `BLOCKED > APPROVAL_REQUIRED > SAFE`.
   - Defaults to fail-closed (`BLOCKED`) for unknown or ambiguous operations.
   - Manages single-use approval tokens and SHA-256 parameter fingerprints.

4. **Execution (Tools & Adapters)**
   - Executes specific controlled operations (Terminal, Browser, Web Research, Git/GitHub, Jules Worker).
   - Sanitizes outputs, redacts secrets, and enforces timeouts.
