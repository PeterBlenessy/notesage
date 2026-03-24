# Bug: Cannot add multiple OpenAI-compatible providers / base URL error

|  |  |
| --- | --- |
| **Date observed** | 2026-03-24 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Blocks users from connecting to multiple custom AI endpoints |
| **Versions affected** | All versions with OpenAI-compatible support |
| **Tasks** | [custom-provider-limitations-tasks](../tasks/2026-03-24-custom-provider-limitations-tasks.md) |

## Symptoms

### Cannot add more than one custom provider

1. Add an OpenAI-compatible connection (e.g., Groq) — works fine
2. Try to add another (e.g., Together AI) — the "OpenAI-Compatible" option in the dropdown is greyed out / disabled
3. No error message or tooltip explaining why

### "Base URL is required" error at runtime

1. Register an OpenAI-compatible provider with all three fields (base URL, model, API key)
2. Try to use it for chat — fails with "Base URL is required for OpenAI-Compatible provider"
3. Health check indicator shows red

## Root causes

### Single-instance limitation (confirmed)

`ConnectionsSettings.tsx` (line \~68, \~336-341):

```typescript
const connectedLabels = new Set(connections.map((c) => c.label));
// ...
const alreadyConnected = connectedLabels.has(option.label);
// Disables the dropdown menu item
```

All OpenAI-compatible connections share the hardcoded label `"OpenAI-Compatible"` (from `PROVIDER_OPTIONS`). After adding one, `connectedLabels.has("OpenAI-Compatible")` returns `true`, disabling the menu item for all future additions.

This was designed for built-in single-instance providers (one Anthropic, one OpenAI), but incorrectly applies to the multi-instance OpenAI-compatible type.

### Config persistence race (likely)

`ConnectionsSettings.tsx` (lines \~204-223):

```typescript
// Step 1: Create connection WITHOUT config
const connectionId = addConnection({ provider: 'openai_compatible', ... });
// Step 2: Update with config separately
updateConnection(connectionId, { config: { baseUrl, model } });
```

The `baseUrl` is stored in `config.baseUrl`, not in `credentials`. If the second call fails silently or the store persist races, the connection exists but has no `baseUrl`. The runtime check in `openai-compatible.ts` then throws:

```typescript
if (!this.config?.baseUrl) {
  throw new Error('Base URL is required for OpenAI-Compatible provider');
}
```

## Affected files

- `src/components/settings/ConnectionsSettings.tsx` — dropdown dedup logic, two-step save flow
- `src/lib/ai/connections.ts` — `PROVIDER_OPTIONS` with shared label
- `src/lib/ai/providers/openai-compatible.ts` — runtime validation
- `src/stores/connections-store.ts` — `addConnection()`, `updateConnection()`

## Proposed fixes

### Multiple providers

1. **Exempt** `openai_compatible` **from label-based dedup:** Check `option.provider !== 'openai_compatible'` before disabling
2. **Allow user-defined labels:** Let users name their custom connections (e.g., "Groq", "Together AI", "My vLLM") instead of the hardcoded "OpenAI-Compatible"
3. **Show count badge:** If multiple are allowed, show how many are connected

### Base URL persistence

4. **Merge into single** `addConnection()` **call:** Pass `config: { baseUrl, model }` directly in the initial `addConnection()` instead of a separate `updateConnection()` — eliminates the race
5. **Add validation on connection load:** On app startup, check that all `openai_compatible` connections have `config.baseUrl` set; if not, mark status as `'error'` with a clear message