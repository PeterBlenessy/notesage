# Seatbelt Deny-First Profile Investigation

**Date:** 2026-03-21
**macOS version tested:** 26.3.1 (Tahoe)
**Task:** sandbox-hardening-macos Task 1

## Root Cause of Previous Failure

Notesage previously tried `(deny network-outbound)` with selective allows — this creates a deny-vs-allow precedence conflict at the same specificity level where Seatbelt behavior is unpredictable.

**Anthropic's sandbox-runtime does NOT use `(deny network*)`**. Instead, it relies on `(deny default)` at the top of the profile (which Notesage already has) and simply omits `(allow network*)`. Network operations are denied by the default deny rule. Selective `(allow network-outbound ...)` rules then punch holes for specific ports.

This means the fix is: **remove `(allow network*)` and add targeted network allows**.

## Validated Profile Rules

The following network rules work correctly on macOS Tahoe:

```scheme
;; (deny default) at the top already blocks all network.
;; No (deny network*) needed — it would create precedence issues.

;; Allow connecting to the proxy port only
(allow network-outbound (remote ip "localhost:<proxy_port>"))

;; Allow localhost bind + inbound for agent subprocess IPC
;; Uses "*:*" for IPv6 dual-stack compatibility (srt pattern)
(allow network-bind (local ip "*:*"))
(allow network-inbound (local ip "*:*"))

;; Unix domain sockets: system IPC
(allow system-socket (socket-domain AF_UNIX))
(allow network-outbound (remote unix-socket (subpath "/var/run")))
(allow network-outbound (remote unix-socket (subpath "/private/var/run")))
(allow network-bind (local unix-socket (subpath "/tmp")))
(allow network-bind (local unix-socket (subpath "/private/tmp")))

;; Go TLS cert verification (needed for Go-based agents like Codex)
(allow mach-lookup (global-name "com.apple.trustd.agent"))

;; Kernel event socket (safe, non-network)
(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))
```

## Additional Fix: /dev/null Write Access

Pre-existing bug: the current Notesage sandbox profile does not allow writing to `/dev/null`, `/dev/tty`, etc. Git fails with "could not open '/dev/null' for reading and writing". This needs to be fixed regardless of the network hardening work.

Add to the `file-write*` allow block:
```scheme
(literal "/dev/null")
(literal "/dev/tty")
(literal "/dev/zero")
(literal "/dev/random")
(literal "/dev/urandom")
```

## Open Questions Resolved

| Question | Answer |
| --- | --- |
| `localhost:*` vs exact proxy port? | Use exact proxy port for outbound. Use `*:*` with `(local ...)` for bind/inbound (IPv6 compat). |
| Which Unix socket paths needed? | `/var/run/*` and `/private/var/run/*` for system IPC. `/tmp` and `/private/tmp` for agent sockets. |
| DNS resolution? | Blocked — DNS resolves through the proxy (outside sandbox). This is correct behavior. |
| `com.apple.trustd.agent`? | Needed for Go TLS cert verification. Already in Mach-lookup allow via blanket `(allow mach-lookup)`. |

## Test Results

| Test | Result |
| --- | --- |
| curl to proxy port (localhost:8899) | PASS |
| curl to external site blocked | PASS (exit 7) |
| curl to other localhost port blocked | PASS |
| node can reach proxy | PASS (HTTP 200) |
| node blocked from external | PASS (EPERM) |
| git runs under profile | PASS (with /dev/null fix) |
| Claude Code binary starts | PASS (v2.1.81) |
| python3 runs under profile | PASS |
