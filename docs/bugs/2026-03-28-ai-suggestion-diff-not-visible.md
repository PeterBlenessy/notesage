# Bug: AI suggestion inline diff not always visible

|  |  |
| --- | --- |
| **Date observed** | 2026-03-28 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | AI actions (Expand, Improve, Summarize) sometimes produce no visible inline diff; user must refresh and re-invoke |
| **Versions affected** | v0.23.2 (current) |
| **Reproducibility** | Intermittent, more frequent under high CPU load |

## Symptoms

1. Select text in the editor
2. Use an AI action (e.g., Expand) from the bubble menu
3. AI generates a response, but no inline diff decorations (green inserts / red deletes) appear
4. Refreshing the document and re-invoking the same action makes the diff visible

## Root Cause

In `ai-suggestion.ts` (lines 282-290), `editor.view.updateState()` is called immediately after dispatching the suggestion transaction, overwriting the pending state:

```typescript
editor.view.dispatch(
  editor.state.tr.setMeta(AISuggestionPluginKey, {
    setSuggestion: true,
    suggestion: { from, to: adjustedTo, originalText, suggestedText },
  })
);

// BUG: overwrites view with pre-dispatch state
editor.view.updateState(editor.state);
```

`editor.state` is captured **before** the dispatch completes. When `updateState()` is called with this stale state, it discards the suggestion metadata before the plugin's `apply()` function can process it into decorations.

### Why it's intermittent

The bug is timing-dependent. If the JavaScript event loop processes the dispatch synchronously before `updateState()` executes, decorations are created correctly. If the event loop is busy (CPU load, concurrent React renders), the dispatch hasn't been processed yet and `updateState()` overwrites it.

### Incorrect API usage

`editor.view.updateState()` is designed for **restoring a previously saved EditorState** (e.g., tab switch in `useEditorTabSwitch.ts:125`). It is not a "force update" mechanism. Calling it after `dispatch()` is both unnecessary (dispatch already triggers the ProseMirror update cycle) and harmful (it can discard pending transactions).

## Suggested Fix

Remove the `editor.view.updateState(editor.state)` call at line 290. The `dispatch()` call already triggers the normal ProseMirror view update mechanism.

## Key Files

| File | Lines | Role |
| --- | --- | --- |
| `src/components/editor/extensions/ai-suggestion.ts` | 282-290 | Bug location: updateState overwrites dispatch |
| `src/components/editor/extensions/ai-suggestion.ts` | 39-50 | Plugin apply() that processes setSuggestion metadata |
| `src/components/editor/BubbleMenu.tsx` | 42-56 | Triggers AI actions |
| `src/hooks/useEditorTabSwitch.ts` | 125 | Correct usage of updateState (tab restore) |
