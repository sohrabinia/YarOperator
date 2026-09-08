# YarOperator Product Vision

## What YarOperator Is

YarOperator is an independent Personal AI Operator foundation designed to act as a trusted personal digital proxy and orchestrator for its human owner. Built upon the strict `Brain ≠ Hands` architectural separation and fail-closed security policy, YarOperator coordinates tools, workflows, workspaces, and external worker agents with clear governance and auditability.

## Problem Domain

Modern personal automation requires delegating complex multi-step tasks across terminal, web browser, research, Git, and cloud services without compromising security or handing unrestricted system/credential access to LLMs or external agents. YarOperator provides a governed, deterministic operator layer that enforces authorization boundaries, single-use approvals, and transactional scheduling.

## Core Relationships

- **Owner (Human)**: The authoritative owner who delegates tasks, defines policy constraints, and grants single-use approvals for high-risk actions.
- **Workspaces**: Isolated execution environments (e.g. YarTrader, personal workspaces, project repos) managed with distinct context and security boundaries.
- **External AI Workers (e.g. Jules)**: Specialized sub-agents or LLM services whose outputs are treated strictly as UNTRUSTED DATA and validated before execution.

## What YarOperator Is NOT

- YarOperator is NOT an unrestricted autonomous shell or generic auto-agent that can execute unmonitored code.
- YarOperator is NOT a credential scraper or security bypass framework.
- YarOperator is NOT a monolithic LLM application that mixes reasoning with raw system privileges.
