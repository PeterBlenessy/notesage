# Sandbox Runtime Comparison: Notesage vs Anthropic `sandbox-runtime` (srt)

**Date:** 2026-03-21 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [network-sandboxing](../prds/2026-03-16-network-sandboxing.md) | Complete |
| Tasks | [network-sandboxing-tasks](../tasks/2026-03-16-network-sandboxing-tasks.md) | Complete |
| PRD | [sandbox-hardening-macos](../prds/2026-03-21-sandbox-hardening-macos.md) | Draft |
| Tasks | — | Not planned |

**Context:** Comparison of Notesage's network sandboxing implementation against Anthropic's open-source `@anthropic-ai/sandbox-runtime` (v0.0.42), used by Claude Code.

## Background

Both projects independently converged on the same fundamental architecture: OS-native sandboxing primitives (Seatbelt on macOS, Bubblewrap on Linux) combined with user-space HTTP proxies for domain-level network filtering. No Docker or VMs.

## What Notesage Has Today

Notesage's network sandboxing is **implemented and shipping** (v0.22.0+):

- **HTTP proxy** (`network_proxy.rs`, 744 lines) — TCP listener on localhost, HTTP CONNECT tunneling for HTTPS, plain HTTP forwarding
- **Per-agent domain allowlists** — built-in defaults per provider + user-configurable in connection settings
- **Domain approval UI** (`DomainApprovalCard.tsx`) — Allow once / Allow session / Allow always / Deny
- **Permission persistence** (`permission-store.ts`) — session + always tiers via Zustand persist
- **Settings UI** (`ConnectionConfigDialog.tsx`) — Network Restriction toggle with domain list, telemetry toggle
- **Proxy env injection** (`acp.rs`) — `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` injected into agent env
- **Auto-approve known domains** (`ChatPanel.tsx`) — checks permission store before showing approval card
- **Proxy lifecycle** — per-agent proxy instances, cleanup on agent exit, `stop_all_sync` on app exit
- **Wildcard domain matching** — `*.example.com`, case-insensitive, suffix-bypass protection, unit tested
- **30-second timeout** — unanswered domain requests auto-denied (both backend and frontend)

## Identified Gaps

### Gap 1: No Kernel-Level Network Deny (HIGH)

**Current:** Seatbelt profile uses `(allow network*)`. The proxy env vars (`HTTP_PROXY`/`HTTPS_PROXY`) are the **only** enforcement mechanism.

**Risk:** An agent binary that ignores proxy env vars can connect directly to any domain, bypassing all filtering. All current ACP agents are cooperative Node.js processes that respect proxy vars, but a malicious binary would not.

**What** `srt` **does:** Uses `(deny network*)` with selective `(allow network-outbound ...)` rules for localhost proxy ports. Seatbelt enforces at the kernel level — even a binary that ignores env vars cannot reach the network directly.

**Why Notesage diverged:** The PRD describes `(deny network*)` as the intended approach (lines 44-57, 76-94), but implementation found that Seatbelt's rule precedence broke agent startup in practice. From `sandbox.rs` comment:

> "attempts to use (deny network-outbound) with selective allows for localhost broke agent startup in practice, despite being the documented pattern from Anthropic/OpenAI sandbox-runtime. Seatbelt's rule precedence appears to favor deny over more specific allows in some configurations."

**Status in PRD:** Mentioned in Open Questions (line 437) as resolved, but the PRD's Technical Approach section still describes the ideal `(deny network*)` architecture. Not documented as a known limitation.

**Recommendation:** Investigate further — `srt` successfully uses Seatbelt deny rules. The issue may be in the specific rule syntax or ordering. Try `srt`'s exact profile pattern.

### Gap 2: No Linux Network Namespace Isolation (HIGH)

**Current:** The bwrap command does **not** use `--unshare-net`. From `sandbox.rs` (lines 174-180):

> "Note: --unshare-net blocks all network including localhost. We skip it for now since the proxy runs on localhost TCP. \[...\] Full Linux network isolation requires iptables rules or socat bridging (future work)."

**Risk:** On Linux, agents can bypass the proxy entirely — there is no OS-level network restriction at all, only env vars.

**What** `srt` **does:** Uses `--unshare-net` to create a fully isolated network namespace, then bridges the proxy into the sandbox via socat Unix socket forwarding. This provides true network isolation.

**Status in PRD:** The PRD describes `--unshare-net` as the approach (lines 98-106) but the implementation silently skips it. Not documented as a known gap.

**Recommendation:** Implement the socat bridge pattern from `srt` — run the proxy outside the namespace, bridge via Unix socket bind-mounted into the sandbox. This is the standard approach for bwrap network sandboxing.

### Gap 3: No seccomp-BPF Unix Socket Filtering (MEDIUM)

**Current:** No syscall filtering is applied. Sandboxed agents can create Unix domain sockets freely.

**Risk:** An agent could communicate with other local services via Unix sockets, bypassing network proxy filtering. On Linux, this is especially relevant since `AF_UNIX` sockets are a common IPC mechanism.

**What** `srt` **does:** Uses seccomp-BPF to block `socket(AF_UNIX)` syscall, preventing sandbox escapes via local sockets. Has a dedicated `generate-seccomp-filter.ts` module.

**Status in PRD:** Not mentioned anywhere.

**Recommendation:** Add seccomp-BPF filtering on Linux to block `AF_UNIX` socket creation. On macOS, Seatbelt rules can restrict `network-unix` access (already partially used in the PRD's proposed profile).

### Gap 4: No Violation Monitoring (MEDIUM)

**Current:** When the proxy denies a domain, it logs to `notesage::network_proxy` and sends a chat message. But there is no monitoring of **OS-level** sandbox violations (Seatbelt denials, bwrap namespace violations).

**What** `srt` **does:** Streams macOS kernel sandbox violation logs in real-time via `sandbox-violation-store.ts`. Every `Sandbox: deny` event from the kernel is captured, categorized, and surfaced. This reveals when agents attempt operations the sandbox blocks — even operations the agent doesn't report.

**Status in PRD:** Listed as a non-goal ("Monitoring or logging network traffic for analytics", line 29). However, violation monitoring is different from traffic analytics — it's about security visibility.

**Recommendation:** On macOS, stream Seatbelt violation logs (e.g., from `log stream --predicate 'process == "sandbox"'`) and surface them in the Activity panel. This provides an audit trail independent of agent cooperation.

### Gap 5: No Dynamic Reconfiguration (LOW)

**Current:** Sandbox profiles are generated at agent spawn time. Changing sandbox configuration requires restarting the agent.

**What** `srt` **does:** Supports `--control-fd` — a JSON lines protocol over a file descriptor that allows the parent process to update sandbox config (add domains, modify paths) mid-session without restarting the agent.

**Status in PRD:** Not mentioned.

**Recommendation:** Low priority for Notesage. The per-spawn model works well for ACP agents since respawning is already triggered by workspace changes. Only consider if users report friction from agent restarts on config changes.

### Gap 6: No SOCKS5 Proxy (LOW)

**Current:** Only HTTP proxy (CONNECT for HTTPS, forwarding for plain HTTP). Raw TCP connections bypass the proxy.

**What** `srt` **does:** Runs both HTTP and SOCKS5 proxies (`@pondwader/socks5-server`). SOCKS5 handles non-HTTP TCP traffic.

**Status in PRD:** Intentionally out of scope (lines 433, 445). All tested ACP agents use HTTP/HTTPS exclusively.

**Recommendation:** Defer unless an agent requires raw TCP. The current HTTP CONNECT approach covers all HTTPS traffic.

## What Notesage Does Better Than `srt`

These are areas where Notesage's implementation is stronger:

1. **Defense in depth (3 layers):** Installation boundary (`~/.notesage/agents/bin`) + OS sandbox + ACP permission approval. `srt` is a single-layer sandbox.

2. **Hardcoded security boundaries:** `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env` denials are non-configurable. `srt`'s denials are fully user-configurable (flexibility, but a footgun).

3. **Context isolation:** Per-project context boundaries in the ACP protocol prevent cross-project data leakage within the same agent process. `srt` has no concept of application-level context.

4. **Zero-dependency deployment:** Notesage's sandbox is compiled Rust. `srt` requires Node.js 18+ installed globally, plus `rg` on Linux for glob expansion.

5. **Integrated UI:** Domain approval cards, connection settings, permission persistence — all built into the app. `srt` is CLI-only with no UI.

## Priority Summary

| Gap | Severity | Effort | Recommendation |
| --- | --- | --- | --- |
| 1\. No kernel network deny | High | Medium | Re-investigate Seatbelt deny rules using `srt`'s exact profile pattern |
| 2\. No Linux network namespace | High | Medium | Implement socat bridge + `--unshare-net` |
| 3\. No seccomp-BPF | Medium | Small | Add `AF_UNIX` socket blocking on Linux |
| 4\. No violation monitoring | Medium | Medium | Stream Seatbelt violation logs to Activity panel |
| 5\. No dynamic reconfig | Low | Large | Defer — per-spawn model is sufficient |
| 6\. No SOCKS5 | Low | Medium | Defer — HTTP CONNECT covers all agents |

## References

- `srt` repo: `anthropic-experimental/sandbox-runtime` on GitHub
- `srt` version analyzed: 0.0.42 (March 12, 2026)
- Notesage network proxy: `src-tauri/src/commands/network_proxy.rs`
- Notesage sandbox profiles: `src-tauri/src/commands/sandbox.rs`
- Notesage network sandboxing PRD: `docs/prds/2026-03-16-network-sandboxing.md`