# YarOperator Contributing & Governance Guidelines

## 1. Governance Rules for Automated Worker Agents (Jules)

1. **Inspect Project State First**: Worker agents must inspect `PROJECT_STATE.md` at the repository root before starting any task to establish the factual baseline.
2. **Verify Git Baseline**: Always verify that the local repository HEAD matches the mandatory base SHA provided in task instructions (`git rev-parse HEAD`).
3. **Second Approval Rule**: All architectural decisions and feature plans require explicit owner/CTO approval before code execution begins.
4. **Operate Strictly Within Authorized Scope**: Do not expand tasks beyond explicit instructions. Record out-of-scope opportunities separately.
5. **Hard Stop Conditions**: Stop immediately and report to Mohammad upon triggering any of the 10 Explicit Stop Conditions defined in `AGENTS.md`.
6. **No Silent Changes**: Do not silently bypass security controls, introduce unauthorized packages, or rewrite existing merge baselines.
7. **Evidence-Based Handoffs**: Agent reports must provide verifiable command output (`npm test`, `npm run build`, `npm run lint`, `git diff --check`, `git status`) as proof. Agent statements alone are not evidence.

---

## 2. Completion State Taxonomy

- `IMPLEMENTED`: Code and tests exist in the codebase and pass all checks.
- `VERIFIED`: Behavior has been verified through automated tests, build checks, and (if applicable) visual Playwright screenshots.
- `READY FOR REVIEW`: Handoff report and evidence submitted for CTO review.
- `APPROVED`: Explicit owner/CTO approval received.
- `MERGED`: Code successfully integrated into `main`.
- `DEPLOYED`: Changes applied and active in target environment.

---

## 3. Mandatory Pre-Commit Check Commands

All contributions must pass the project's standard verification suite prior to commit:

```bash
npm test
npm run build
npm run lint
npm run format:check
git diff --check
```
