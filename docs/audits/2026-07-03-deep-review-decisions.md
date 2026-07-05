# Deep Review 2026-07-03 — Batch 0 Decisions

Product decisions for every "wire it or delete it" finding in the 2026-07-03 deep review, made by the project owner on 2026-07-04. These drive the remediation batches (one PR per batch).

## Wire / implement (restore or build the missing side)

| Finding | Decision |
| --- | --- |
| Git-branch diff review unreachable (`startReview` has no caller) | **Rewire via QuietSidebar**: "Compare branch…" trigger on sidebar project/folder items + a small indicator icon showing git is enabled on repo-backed rows |
| "Allow Always" network domains silently session-only | **Implement persistence**: listener for `network-domain-always` → persisted, scoped domain allowlist in `permission-store` (ScopedApproval pattern), consulted before prompting, revocable in Settings > Privacy > Approvals |
| `typewriterScrolling` setting has no implementation | **Implement the feature**: caret-centered scrolling in the editor + Settings > Editor toggle |
| `useEditorImageDrop` tested but never mounted | **Wire it** into the editor container |
| `agent_uninstall` command has no UI | **Wire an Uninstall UI** on managed-agent connection cards (with confirm) |
| `copilot_lsp_sign_out` command has no UI | **Wire a Sign out UI** on the Copilot LSP connection card |
| `copilot-chat-step` / `copilot-chat-tool-update` emitted, never listened | **Wire listeners + segment UI** in useCopilotChat (parity with ACP agents) |
| `mcp_list_tools` duplicates `mcp_list_tools_from_server` | **Unify as cache-first read-through**: return cached tools, live-query only when cache empty or refresh requested |
| `mcp_get_server_status` never consumed | **Wire an MCP status refresh** in Settings |
| `store_read_batch` startup optimization never adopted | **Adopt at startup** store hydration + record perf baseline entry |
| `network_proxy_status` never consumed | **Build a minimal sandbox observability panel** (per-agent proxy port, allowlisted domains, session-domain count); full observability PRD stays follow-up |

## Delete (confirmed dead)

| Finding | Decision |
| --- | --- |
| `agent_install_node_runtime` command | Delete (runtime auto-installs inside Gemini install; keep `download_node_runtime`) |
| `fetch_hf_metadata` command wrapper | Delete (keep `fetch_hf_metadata_inner`, used by enrichment pipeline) |
| `parse_gguf_metadata` command wrapper | Delete (keep parser + internal cached path) |
| `sandbox_monitor_register_pid` / `unregister_pid` | Delete both (superseded by internal `register_and_start` in acp.rs) |
| `searchProvider` setting | Remove field + persist migration |
| `tray-quick-note` dead listener | Remove listener + `onQuickNote` prop (Quick Capture removal stays final) |
| Dead emits `agent-update-available`, `agent-install-done`, `copilot-auth-browser-open` | Remove all three |
| Legacy `settings/AISettings.tsx` + orphaned `suggestionsEnabled` | Delete component + store field |
| `svg-to-png.ts` (superseded by Rust rasterization) | Delete module + test |
| `goal-templates.ts`, `SavedLabel.tsx`, `ChangeListPopover.tsx`, `AttachmentStrip.tsx`, `setDebugLogging` | Delete (from the dead-code findings; no decision needed — pure orphans) |
| Cargo deps `async-trait`, `typst-library`, `typst-utils` | Remove (verify with cargo build) |

## Remediation batches

1. **Batch 1** — runtime bug fixes (instant-load races, error boundaries, chat-list rendering, async/cancel gaps, Allow Always persistence)
2. **Batch 2** — dead-code removal + documentation drift + listener/leak pattern fixes + render-perf LOWs
3. **Batch 3** — Rust backend hardening
4. **Batch 4** — trust-boundary validators
5. **Batch 5** — wire the half-wired features (table above)
6. **Batch 6** — large-file refactors, one PR each (useAgentTaskOperations → useAcpLifecycle → Editor.tsx → acp.rs → mcp.rs → McpServersSettings → markdown.ts → chat/activity splits → FloatingCommandBar)
