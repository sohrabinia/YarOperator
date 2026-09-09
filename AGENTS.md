# AGENTS.md — Worker Agent Governance & Operating Rules

This file governs the automated execution rules for Jules and other AI worker agents operating within the YarOperator codebase.

## 1A. SECOND APPROVAL RULE

All development tasks, architectural decisions, and feature implementations require owner approval on the proposed plan and architecture before automated code execution begins.

## 1B. EXPLICIT IMPLEMENTATION STOP CONDITION

This is a HARD STOP mechanism.

During implementation, Jules MUST immediately stop coding and return control to Mohammad if ANY of the following occurs:

### STOP CONDITION 1 — ARCHITECTURAL DEVIATION

The implementation requires a material change to the architecture that was approved in Phase A.

Examples:

- changing the authentication protocol
- changing the session architecture
- changing Owner identity mapping
- introducing a different authorization mechanism
- bypassing the existing authentication boundary
- changing the mobile access architecture
- introducing a new external authentication provider

Action:

STOP.

Do not implement the deviation.

Report:

- what changed
- why it is necessary
- what alternatives were considered
- security implications
- affected files
- proposed solution

Then wait for explicit owner approval.

---

### STOP CONDITION 2 — AUTHORITY MODEL IMPACT

If implementation requires modifying or bypassing any of the following:

- Owner identity model
- Authority model
- Policy engine
- Approval mechanism
- Autonomy boundaries
- OwnerCommandReceiver
- safety gates

STOP IMMEDIATELY.

Do not work around the restriction.

Request explicit approval.

Authentication must NEVER become a mechanism for bypassing existing authority controls.

---

### STOP CONDITION 3 — PRODUCTION INFRASTRUCTURE CHANGE

If implementation requires changing:

- IIS
- ARR
- Cloudflare
- DNS
- firewall
- router
- TLS certificates
- public ports
- reverse proxy
- NSSM/service configuration
- production environment variables
- production secrets

STOP before applying the change.

The code implementation may continue only if it can safely be completed without applying the infrastructure change.

Otherwise report the exact required infrastructure change and wait for explicit approval.

---

### STOP CONDITION 4 — SECRET OR CREDENTIAL REQUIREMENT

If implementation requires access to:

- Google client secret
- OAuth credentials
- session secret
- Bearer token
- API key
- password
- private key
- production credential
- Cloudflare token
- server credential

STOP.

Do not request that Mohammad paste the secret into chat.

Instead:

- identify the required configuration variable
- provide the expected variable name
- provide a placeholder/example
- explain where it must be configured securely

Never print the secret value in a report.

---

### STOP CONDITION 5 — UNEXPECTED REPOSITORY MODIFICATION

If the implementation unexpectedly requires modification of files outside the approved scope:

STOP before modifying those files.

Report:

- file
- reason
- dependency
- proposed modification

Continue only after determining that the change is clearly within the approved scope or obtaining explicit approval when it is not.

---

### STOP CONDITION 6 — SECURITY REGRESSION

STOP immediately if the proposed implementation would:

- expose authentication tokens
- expose session identifiers
- weaken CSRF protection
- weaken HTTPS requirements
- allow unauthorized Google accounts
- bypass Owner authorization
- expose the Operator API publicly without authentication
- store sensitive credentials insecurely
- introduce an authentication bypass
- trust spoofable proxy headers
- create an open redirect
- weaken an existing security control

Do not "temporarily" implement an insecure solution merely to make the feature work.

---

### STOP CONDITION 7 — TEST / VALIDATION FAILURE

If an authentication, authorization, security, or regression test fails:

DO NOT:

- delete the test
- weaken the assertion
- disable the security check
- mark the test as skipped without justification
- modify unrelated behavior simply to make the suite green

STOP and investigate.

If the failure indicates that the approved architecture is incorrect, return to the approval gate.

---

### STOP CONDITION 8 — PRODUCTION ACCESS CANNOT BE VERIFIED SAFELY

If desktop authentication works but mobile/remote access cannot be safely verified because of missing:

- HTTPS configuration
- reverse proxy configuration
- DNS
- Cloudflare configuration
- firewall access
- production environment configuration

do NOT claim the feature is complete.

Report:

"IMPLEMENTATION STATUS: CODE COMPLETE — PRODUCTION/MOBILE VALIDATION BLOCKED"

Clearly identify what remains unverified.

---

### STOP CONDITION 9 — UNEXPECTED BEHAVIOR

If repository behavior differs materially from the assumptions made during the architectural review:

STOP.

Do not silently adapt the implementation.

Update the FACT / INFERENCE / PROPOSAL / RISK assessment and determine whether owner re-approval is required.

---

### STOP CONDITION 10 — SCOPE CREEP

If implementation reveals unrelated problems or opportunities for refactoring:

DO NOT expand the task automatically.

Record them separately as:

"OUT OF SCOPE — FOLLOW-UP"

The current implementation must remain focused on:

Google Authentication +
Authorized Owner Mapping +
Secure Session +
Desktop Access +
Mobile Access

---

# MANDATORY STOP REPORT FORMAT

Whenever a stop condition is triggered, immediately stop modifying the repository and report:

STOP CONDITION TRIGGERED: <number>

CATEGORY: <category>

WHAT HAPPENED: <clear explanation>

CURRENT STATE:
<what has already been changed, if anything>

PROPOSED NEXT STEP: <proposed action>

SECURITY IMPACT: <impact>

OWNER APPROVAL REQUIRED:
YES

IMPLEMENTATION STATUS:
BLOCKED — WAITING FOR OWNER DECISION

Do not continue until Mohammad explicitly authorizes the proposed next step.

---

# FINAL IMPLEMENTATION RULE

A green test suite does NOT override this stop condition.

A technically working implementation does NOT override this stop condition.

Time pressure does NOT override this stop condition.

Convenience does NOT override this stop condition.

Jules must stop whenever continuing would cross an architectural, security, authority, repository, secret, or production-infrastructure boundary that has not been explicitly approved.

The final authority for crossing these boundaries remains Mohammad.

No silent architectural decisions.
No silent security compromises.
No silent production changes.
No silent scope expansion.
