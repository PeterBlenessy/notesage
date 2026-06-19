# Wikilink resolution is workspace-global; link edges never auto-widen AI context

Wikilink resolution and navigation are workspace-global: the `[[` autocomplete
searches every project plus the notes root, clicking a resolved link navigates
anywhere, and the index stores the full cross-project link graph so the
backlinks / relations panel shows cross-project edges. This is a **human
navigation primitive**. The AI-context builder keeps its existing per-selected-
project isolation gate, so following a link edge **never** automatically pulls
another project's concept into a prompt. An agent may cross a project boundary
to read a linked concept only via an **explicit permission prompt** — the same
tiered allow-once / session / always pattern already used for tool calls and
domain approvals.

The bright line: *a link is a navigation edge for a human, not a context-
inclusion grant for an agent.* Crossing it for AI requires the user to approve,
per request.

## Considered Options

- **Global all the way down (D2)** — let cross-project linked concepts flow into
  AI context automatically. Rejected: punches a hole in the project-isolation
  guarantee the 2026-04-20 red-team pass locked down.
- **Panel stays project-scoped (D3)** — global autocomplete/navigation but
  per-project backlinks. Rejected: backlinks would silently under-report
  cross-project "linked from" edges — a confusing half-measure.

## Consequences

- The cross-project link graph is the one index structure that intentionally
  spans the isolation boundary, so it must be physically isolated from anything
  that feeds AI context and easy to audit against the no-auto-widen rule.
- A cross-project context request needs a permission surface (reuse the existing
  tiered permission card) and a scoped/persisted approval, mirroring tool-call
  approvals.
