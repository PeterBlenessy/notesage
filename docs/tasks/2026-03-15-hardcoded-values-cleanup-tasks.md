# Tasks: Hardcoded Values Cleanup

**PRD:** [docs/prds/2026-03-15-hardcoded-values-cleanup.md](../prds/2026-03-15-hardcoded-values-cleanup.md) **Status:** ✅ Complete (7/7)
**Remaining items:** [docs/tasks/2026-03-17-hardcoded-values-remaining-tasks.md](2026-03-17-hardcoded-values-remaining-tasks.md) (4/4 complete)
**Total:** 7 tasks (3S, 3M, 1L) **Suggested order:** Sequential #1–#7. Tasks #2–#5 are independent after #1 and can be parallelized.

## Risks

- **High blast radius on #2–#5** — mechanical find-and-replace across core AI command files. Each replacement must compile and preserve identical behavior. Run `cargo check` after each file.
- **#6 (dynamic** `/props` **detection)** is the only task that adds new logic rather than moving existing code. Test with a custom model that has thinking tags in its chat template, and with one that doesn't.

---

## Task 1: Create `constants.rs` and `constants.ts` modules ✅

**Complexity:** S | **Category:** both | **Dependencies:** none

**Description:**

Create `src-tauri/src/commands/constants.rs` with all constants from the PRD (default models, API versions, fallback thinking tags, macOS paths, tuning parameters, web search tool IDs). Add `pub mod constants;` to `src-tauri/src/commands/mod.rs`.

Create `src/lib/ai/constants.ts` with `DEFAULT_MODELS` object. Add a comment noting it must stay in sync with `constants.rs`.

**Acceptance criteria:**

- `constants.rs` compiles with all constants from PRD section A
- `constants.ts` exports `DEFAULT_MODELS` with `as const`
- Neither file is imported yet — no behavior change

**Files:**

- Create `src-tauri/src/commands/constants.rs`
- Edit `src-tauri/src/commands/mod.rs`
- Create `src/lib/ai/constants.ts`

---

## Task 2: Replace default model names across `ai.rs` and `ai_streaming.rs` ✅

**Complexity:** M | **Category:** backend | **Dependencies:** #1

**Description:**

Replace all 9 hardcoded default model string literals with constants:

| Location | Replace with |
| --- | --- |
| `ai.rs:227`, `ai.rs:286` | `constants::DEFAULT_MODEL_ANTHROPIC` |
| `ai.rs:357`, `ai.rs:415` | `constants::DEFAULT_MODEL_OPENAI` |
| `ai.rs:503`, `ai.rs:558` | `constants::DEFAULT_MODEL_OLLAMA` |
| `ai_streaming.rs:204` | `constants::DEFAULT_MODEL_ANTHROPIC` |
| `ai_streaming.rs:415` | `constants::DEFAULT_MODEL_OPENAI` |
| `ai_streaming.rs:593` | `constants::DEFAULT_MODEL_OLLAMA` |

Update `connections.ts` to import `DEFAULT_MODELS` from `constants.ts` instead of defining inline.

**Acceptance criteria:**

- `grep -rn 'claude-sonnet-4-5' src-tauri/src/commands/` returns only `constants.rs`
- `grep -rn 'gpt-4o' src-tauri/src/commands/` returns only `constants.rs`
- `grep -rn 'llama3.2' src-tauri/src/commands/` returns only `constants.rs`
- `connections.ts` no longer defines `DEFAULT_MODELS` inline
- `cargo check` passes

**Files:**

- Edit `src-tauri/src/commands/ai.rs`
- Edit `src-tauri/src/commands/ai_streaming.rs`
- Edit `src/lib/ai/connections.ts`

---

## Task 3: Replace API versions and web search constants ✅

**Complexity:** S | **Category:** backend | **Dependencies:** #1

**Description:**

Replace all Anthropic API version headers and web search tool identifiers:

| Location | Replace with |
| --- | --- |
| `ai.rs:119`, `ai.rs:252`, `ai.rs:329` | `constants::ANTHROPIC_API_VERSION` |
| `ai_streaming.rs:256` | `constants::ANTHROPIC_API_VERSION` |
| `ai_streaming.rs:247` | `constants::ANTHROPIC_WEB_SEARCH_TOOL` |
| `ai_streaming.rs:249` | `constants::ANTHROPIC_WEB_SEARCH_MAX_USES` |
| `ai_streaming.rs:473` | `constants::OPENAI_WEB_SEARCH_TOOL` |
| `mcp.rs:335` | `constants::MCP_PROTOCOL_VERSION` |

**Acceptance criteria:**

- `grep -rn '2023-06-01' src-tauri/src/commands/` returns only `constants.rs`
- `grep -rn 'web_search_20250305' src-tauri/src/commands/` returns only `constants.rs`
- `grep -rn '2024-11-05' src-tauri/src/commands/` returns only `constants.rs`
- `cargo check` passes

**Files:**

- Edit `src-tauri/src/commands/ai.rs`
- Edit `src-tauri/src/commands/ai_streaming.rs`
- Edit `src-tauri/src/commands/mcp.rs`

---

## Task 4: Replace tuning parameters in `local_inference.rs` and `ai.rs` ✅

**Complexity:** S | **Category:** backend | **Dependencies:** #1

**Description:**

Replace inline magic numbers with named constants:

| Location | Value | Replace with |
| --- | --- | --- |
| `local_inference.rs:1125` | `1.1` | `constants::REPEAT_PENALTY` |
| `local_inference.rs:1331` | `1.1` | `constants::REPEAT_PENALTY` |
| `local_inference.rs:1453` | `0.1` | `constants::FIM_TEMPERATURE` |
| `local_inference.rs:1487` | `0.1` | `constants::FIM_TEMPERATURE` |
| `local_inference.rs:1489` | `1.1` | `constants::REPEAT_PENALTY` |
| `ai.rs:691` | `0.2` | `constants::CHAT_TEMPERATURE_FIM_FALLBACK` |
| `ai.rs:749` | `0.2` | `constants::CHAT_TEMPERATURE_FIM_FALLBACK` |

**Note:** Be careful to only replace the AI tuning `1.1` / `0.1` / `0.2` values, not unrelated numeric literals. Check surrounding context matches `repeat_penalty` or `temperature` JSON fields.

**Acceptance criteria:**

- No inline `repeat_penalty: 1.1` or `temperature: 0.1`/`0.2` in AI command files outside `constants.rs`
- `cargo check` passes

**Files:**

- Edit `src-tauri/src/commands/local_inference.rs`
- Edit `src-tauri/src/commands/ai.rs`

---

## Task 5: Replace macOS fallback paths and deduplicate thinking tags ✅

**Complexity:** M | **Category:** backend | **Dependencies:** #1

**Description:**

**Fallback paths:** Replace scattered `/opt/homebrew/bin` and `/usr/local/bin` literals in `acp.rs` and `copilot_lsp.rs` with iteration over `constants::MACOS_FALLBACK_BIN_PATHS` and `constants::MACOS_FALLBACK_NODE_MODULE_PATHS`.

The existing code builds `PathBuf` candidates from these paths — refactor to iterate the constant arrays with `.join(binary_name)` instead. Preserve the existing search order (PATH via `shell_path.rs` first, then fallback paths).

**Thinking tags:** Replace both inline 7-tag arrays in `local_inference.rs` (lines \~1168-1176 and \~1384-1391) with `constants::FALLBACK_THINKING_TAGS`. Both the streaming parser and `strip_thinking_tags_for_model` function use the same `None =>` branch for unknown models — change both to reference the shared constant.

**Acceptance criteria:**

- `grep -rn '/opt/homebrew' src-tauri/src/commands/` returns only `constants.rs` (and the comment in `shell_path.rs`)
- `grep -rn 'scratchpad\|internal_thoughts' src-tauri/src/commands/` returns only `constants.rs`
- `cargo check` passes

**Files:**

- Edit `src-tauri/src/commands/acp.rs`
- Edit `src-tauri/src/commands/copilot_lsp.rs`
- Edit `src-tauri/src/commands/local_inference.rs`

---

## Task 6: Dynamic thinking tag detection from `/props` chat_template ✅

**Complexity:** L | **Category:** backend | **Dependencies:** #1, #5

**Description:**

Add dynamic thinking tag detection for custom/unknown models by parsing the `chat_template` field from llama-server's `GET /props` endpoint.

**Implementation:**

1. Add `detect_thinking_tags_from_template(port: u16) -> Option<(String, String)>` to `local_inference.rs`. Calls `GET /props`, extracts `chat_template` string.

2. Add `parse_thinking_tags_from_jinja(template: &str) -> Option<(String, String)>` that scans Jinja2 templates for thinking patterns:

   - Look for `{% if thinking %}` / `{% if message.role == "thinking" %}` blocks
   - Extract the literal tag strings surrounding those blocks (e.g., `<think>` / `</think>`)
   - Handle common variants: `{%- if`, `{% if message['role'] == 'thinking'`, etc.

3. Update the thinking tag resolution order in the streaming function:

   - Catalog entry with `thinking_tags` → use those (unchanged)
   - Catalog entry with `supports_thinking: true`, no tags → use `<think>` (unchanged)
   - Catalog entry with `supports_thinking: false` → skip (unchanged)
   - **No catalog entry → call** `detect_thinking_tags_from_template()` **→ if found, use detected tags → else fall back to** `FALLBACK_THINKING_TAGS`

4. Same for `strip_thinking_tags_for_model` — but since it's sync and doesn't have the port, either:

   - Cache the detected tags in `LocalInferenceState` on model load, or
   - Accept detected tags as a parameter

**Acceptance criteria:**

- Custom model with `<think>` in its chat template → tags detected from `/props`, not from hardcoded fallback
- Custom model with `<reasoning>` tags in template → those specific tags detected
- Custom model with no thinking in template → falls back to `FALLBACK_THINKING_TAGS`
- `/props` unavailable (server not running) → falls back gracefully
- Catalog models unaffected — still use their `thinking_tags` metadata
- `cargo check` passes

**Files:**

- Edit `src-tauri/src/commands/local_inference.rs`

---

## Task 7: Verification — grep audit and compile check ✅

**Complexity:** M | **Category:** both | **Dependencies:** #2, #3, #4, #5, #6

**Description:**

Final verification pass against all code health quality gates from the PRD.

Run grep checks:

- No raw `"claude-sonnet"`, `"gpt-4o"`, `"llama3.2"` outside `constants.rs` / `constants.ts`
- No raw `"2023-06-01"` outside `constants.rs`
- No raw `/opt/homebrew` outside `constants.rs` (and `shell_path.rs` comment)
- No raw `"web_search_20250305"` or `"web_search_preview"` outside `constants.rs`
- No duplicate thinking tag arrays
- No inline `repeat_penalty` / `temperature` values outside `constants.rs`

Run `cargo check` and `pnpm tauri dev` to confirm everything compiles and the app starts.

**Acceptance criteria:**

- All code health quality gates from the PRD pass
- App compiles and runs without errors
- Mark PRD quality gate checkboxes

**Files:**

- Edit `docs/prds/2026-03-15-hardcoded-values-cleanup.md` (mark quality gates)