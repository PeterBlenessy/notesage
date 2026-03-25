# Audit Reports

This folder contains codebase audit reports for Notesage. Each audit is a single markdown document covering all findings from that audit run.

## Naming Convention

Files are named by date: `YYYY-MM-DD-<scope>.md`

- `scope` describes what was audited (e.g., `full-codebase`, `frontend-performance`, `rust-backend`)

## What Audits Cover

Audits typically investigate some or all of:

- **Large files** — oversized components/hooks, separation of concerns, decomposition opportunities
- **Memory leaks** — event listener cleanup, intervals, DOM events, process/resource lifecycle
- **Async flows** — race conditions, stale closures, missing cancellation, error handling gaps
- **Render performance** — Zustand subscription patterns, memoization, re-render triggers
- **Rust backend** — mutex patterns, panic vectors, process management, error handling, security

Each audit includes severity ratings (HIGH / MEDIUM / LOW) and recommended actions.
