# Bug: Copilot LSP restricted to inline completion only

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Severity** | Medium |
| **Status** | Fixed — Copilot LSP now supports chat, agent tasks, and inline completions via `conversation/*` JSON-RPC methods |
| **Affects** | Copilot LSP connection, chat panel, provider routing |

## Problem

The GitHub Copilot LSP connection can only be assigned to the "Inline Completion" routing slot. It does not appear as an option for "Interactive" (chat + inline actions) or "Agent Tasks" routing. This means users with a Copilot subscription cannot use its models (GPT-4o, Claude, etc.) for chat conversations — only for ghost text completions.

The model picker correctly lists all available Copilot models, making the restriction feel arbitrary and frustrating. Users who only have Copilot (no separate API keys, no CLI access) are locked out of chat entirely.

## Expected behavior

The Copilot LSP connection should be available for all routing slots — interactive chat, agent tasks, and inline completion — allowing users to leverage their Copilot subscription for all AI features.

## Current implementation

The restriction is intentional in the current code:
- `capabilities` on the Copilot LSP connection is hardcoded to `['inline_completion']`
- The routing UI filters connections by capability, so Copilot LSP never appears in interactive/agent dropdowns
- The rationale was that the LSP protocol (`textDocument/inlineCompletion`) only supports completions, not multi-turn chat

However, the Copilot LSP may support chat-like interactions through other protocol methods, or the connection could be extended to use the Copilot API directly for chat (similar to how the Copilot CLI uses ACP for chat).

## Possible approaches

1. **Extend Copilot LSP capabilities** — if the LSP supports chat methods (e.g., `conversation/create`), add them alongside inline completion
2. **Add a separate Copilot API connection type** — use the Copilot token from the LSP OAuth to make direct API calls for chat (similar to how VS Code Copilot Chat works)
3. **Remove the capability restriction** — allow routing to Copilot LSP for all use cases and handle unsupported operations gracefully

## Key files

- `src/stores/connections-store.ts` — connection capabilities definition
- `src/stores/routing-store.ts` — per-use-case routing with capability filtering
- `src-tauri/src/commands/copilot_lsp.rs` — Copilot LSP lifecycle
- `src/hooks/useCopilotCompletion.ts` — Copilot completion hook
- `docs/features/ai-providers.md` — documents the `['inline_completion']` restriction
