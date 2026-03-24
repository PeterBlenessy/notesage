# Custom Provider Limitations — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Complete |
| **Source** | [custom-provider-limitations](../bugs/2026-03-24-custom-provider-limitations.md) |
| **Total** | 5 tasks: 3S, 2M |
| **Suggested order** | Store (#1) → Settings UI (#2-#4) → Validation (#5) |

**Risks / open questions:**

- Routing store references connections by ID — multiple OpenAI-compatible connections should work without changes since each gets a unique ID
- Existing users with one OpenAI-compatible connection must not break (label migration)

---

## Task 1: Merge two-step addConnection into single atomic call

- [x] **Done**

**Description:** The current flow calls `addConnection()` without `config`, then immediately calls `updateConnection()` to set `baseUrl` and `model`. If the second call fails or races with persist, the connection exists without a base URL, causing runtime errors. Merge into a single `addConnection()` call that includes `config`.

**Complexity:** S
**Category:** frontend
**Dependencies:** None

**Files:**
- `src/stores/connections-store.ts` — extend `addConnection` parameter type to accept optional `config`
- `src/components/settings/ConnectionsSettings.tsx` — pass `config: { baseUrl, model }` directly in `addConnection()`, remove the separate `updateConnection()` call

**Acceptance criteria:**
- `addConnection()` accepts an optional `config` field
- OpenAI-compatible connections are created with `config.baseUrl` and `config.model` in a single call
- No separate `updateConnection()` call after `addConnection()` for new OpenAI-compatible connections

---

## Task 2: Exempt openai_compatible from label-based dedup

- [x] **Done**

**Description:** The dropdown disables provider options when `connectedLabels.has(option.label)` is true. Since all OpenAI-compatible connections share the label `"OpenAI-Compatible"`, only one can be added. Exempt `openai_compatible` from this check so users can add multiple custom endpoints.

**Complexity:** S
**Category:** frontend
**Dependencies:** None

**Files:**
- `src/components/settings/ConnectionsSettings.tsx` — modify `alreadyConnected` logic to skip dedup for `openai_compatible` provider

**Acceptance criteria:**
- After adding one OpenAI-compatible connection, the dropdown still allows adding another
- Built-in single-instance providers (Anthropic, OpenAI, Ollama) remain correctly deduplicated
- Already-connected check mark still shows for single-instance providers

---

## Task 3: Support user-defined labels for OpenAI-compatible connections

- [x] **Done**

**Description:** Let users name their custom connections (e.g., "Groq", "Together AI", "My vLLM") instead of all showing as "OpenAI-Compatible". Add a "Name" input to the ConfigureForm when provider is `openai_compatible`. The label is used in the connections list, routing dropdowns, and chat footer.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #2

**Files:**
- `src/components/settings/ConnectionsSettings.tsx` — add Name input to ConfigureForm for `openai_compatible`, pass user label to `addConnection()` instead of hardcoded `option.label`
- `src/components/settings/ConnectionsSettings.tsx` — show editable label in connection card for `openai_compatible` connections (inline edit or edit button)

**Acceptance criteria:**
- ConfigureForm shows a "Name" field (pre-filled with "OpenAI-Compatible") when adding an openai_compatible connection
- User-provided label appears in connection cards, routing dropdowns, and chat footer
- Existing connections without custom labels continue showing "OpenAI-Compatible"
- Label is editable after creation (via connection card or edit flow)

---

## Task 4: Show connected count for multi-instance providers

- [x] **Done**

**Description:** When multiple OpenAI-compatible connections exist, show a count badge next to the "OpenAI-Compatible" option in the Add Connection dropdown so users see how many are configured.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #2

**Files:**
- `src/components/settings/ConnectionsSettings.tsx` — count connections where `provider === 'openai_compatible'`, render badge in dropdown item

**Acceptance criteria:**
- Dropdown shows "(2 connected)" or similar badge next to OpenAI-Compatible when multiple exist
- Badge hidden when zero connected
- Badge style consistent with design system (muted text, no chromatic color)

---

## Task 5: Validate openai_compatible connections on startup

- [x] **Done**

**Description:** On app startup, check that all `openai_compatible` connections have `config.baseUrl` set. If not, mark their status as `'error'` with a clear message. This catches orphaned connections from the pre-fix two-step save race.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1

**Files:**
- `src/stores/connections-store.ts` — add a `validateConnections()` method that checks `openai_compatible` connections for required `config.baseUrl`; call it from the store's `onRehydrateStorage` callback or as a migration
- `src/components/settings/ConnectionsSettings.tsx` — render error state for connections with `status === 'error'` (if not already handled)

**Acceptance criteria:**
- On app launch, `openai_compatible` connections missing `config.baseUrl` are flagged with `status: 'error'`
- Error status is visible in the connections list (e.g., red indicator, error message)
- User can fix by editing the connection (adding the missing base URL)
- Connections with valid `config.baseUrl` are not affected
