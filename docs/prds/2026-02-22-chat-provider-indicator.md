# Chat Provider Indicator

**Date:** 2026-02-22
**Status:** Done
**Parent:** Phase 6.5 — Chat UX & Agent Polish

## Problem

The chat panel has no indication of which AI provider is active. Users can configure multiple connections (Claude Code, OpenAI, Copilot, Gemini, Ollama) and route them to different use cases, but the chat UI doesn't show which connection is powering the current conversation. Old messages give no hint of which provider generated them, making it hard to compare responses or debug issues.

## Goals

- Show the active AI connection in the chat footer (provider logo + label)
- Show which provider generated each assistant message (per-message badge)
- Persist provider info on messages so switching providers doesn't erase history context
- Reuse existing provider logo patterns from the settings UI

## Non-Goals

- Provider-specific model name display (e.g., "Claude Sonnet 4.5") — not available in current data model

## User Stories

- As a user with multiple AI connections, I want to see which provider is active in my chat, so I know who I'm talking to.
- As a user who switches providers, I want old messages to show which provider generated them, so I can compare response quality.
- As a user, I want the provider indicator to be subtle and non-intrusive, so it doesn't distract from the conversation.
- As a user with multiple AI connections, I want to switch providers directly from the chat footer without navigating to Settings.

## Technical Approach

### Shared ProviderLogo Component

`ProviderLogo` and `PROVIDER_LOGOS` are currently duplicated in `ConnectionsSettings.tsx` and `ConnectionCard.tsx`. Extract to a shared `src/components/ProviderLogo.tsx` that accepts a `className` prop for size flexibility.

### ChatMessage Type Extension

Add three optional fields to the `ChatMessage` interface in `src/lib/ai/types.ts`:

```typescript
interface ChatMessage {
  // ... existing fields
  connectionId?: string;        // Connection ID for lookup
  connectionLabel?: string;     // Snapshot of label at generation time
  connectionProvider?: string;  // Snapshot of provider for logo rendering
}
```

Snapshots ensure badges survive connection removal. No migration needed — existing messages simply won't show badges.

### Provider Stamping

In `useAIOperations.sendChatMessage()`, stamp provider info on the assistant placeholder message in both code paths:

- **ACP path**: Use `interactiveConnection` fields directly
- **Direct API path**: Use `interactiveConnection` if available, else fallback to `resolved.provider`

### Chat Footer Connection Picker

Interactive Popover picker (matching the persona selector pattern) as the first element in the chat footer. Shows provider logo + truncated label + ChevronUp chevron. Click opens a popover listing all connections with `interactive` capability. Selecting a connection calls `useRoutingStore.setRouting('interactive', connectionId)` to change the active provider. Active connection highlighted with `bg-accent`. Not rendered when no interactive connections exist.

### Per-Message Badge

Small provider logo + label below assistant message content, above activity log and citations. Uses `text-[10px]` sizing — subtle like a watermark. Only rendered when `connectionProvider` is present and message is not actively streaming.

## Files Modified

| File | Change |
|------|--------|
| `src/components/ProviderLogo.tsx` | New — shared component extracted from settings |
| `src/lib/ai/types.ts` | Add 3 optional fields to ChatMessage |
| `src/hooks/useAIOperations.ts` | Stamp provider info on assistant messages |
| `src/components/chat/ChatPanel.tsx` | Add footer provider indicator |
| `src/components/chat/ChatMessage.tsx` | Add per-message provider badge |
| `src/components/settings/ConnectionCard.tsx` | Import shared ProviderLogo |
| `src/components/settings/ConnectionsSettings.tsx` | Import shared ProviderLogo |

## Quality Gates

- [x] `npx tsc --noEmit` passes
- [x] Footer shows active provider logo + label when connection is configured
- [x] Clicking footer indicator opens popover with interactive-capable connections
- [x] Selecting a connection changes the active provider; new messages use it
- [x] Active connection highlighted in the list
- [x] Footer hides gracefully when no connection is configured
- [x] Assistant messages show provider badge after completion (not during streaming)
- [x] Switching providers mid-conversation: old messages keep old badge, new messages get new badge
- [x] Removing a connection doesn't break badges on existing messages (snapshot fields)
- [x] Provider logos render correctly in both light and dark mode
- [x] Visual style matches design system (neutral greyscale, consistent sizing)
