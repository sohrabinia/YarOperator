# Security Model

## Threat Boundaries

- External web content and AI worker outputs are untrusted data.
- Prompt-injection defense: Untrusted data must never execute code or mutate policy rules.
- Fail-Closed: Any ambiguity in approval or policy defaults to `BLOCKED` or denial.
