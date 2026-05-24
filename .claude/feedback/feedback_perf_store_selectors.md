---
name: Zustand selectors and serialization performance
description: Never use destructured useStore() — always use individual selectors. Debounce editor serialization.
type: feedback
originSessionId: ba64b0dd-a8ca-4f9f-93a2-5a61c4e0c5b1
aw_applies: yes
aw_applies_to: [aw-tdd]
---
Never destructure Zustand stores in hot-path components (e.g., `const { tabs, ... } = useEditorStore()`). Always use individual selectors: `const tabs = useEditorStore((s) => s.tabs)`. Destructured stores re-render on ANY state change.

Similarly, avoid subscribing to `s.tabs` in node view components (charts, drawings, mermaid) — `tabs` changes on every keystroke due to `updateTabContent`. Use derived selectors that extract only stable values like `s.tabs.find(t => t.id === s.activeTabId)?.filePath`.

`getMarkdownFromEditor` must be debounced (150ms) — serializing on every keystroke blocks the main thread for large documents.

File watcher tree refresh must pass `targetPath` to only refresh the affected directory, not all sections (was 1.9s for 682 files across 10 sections on iCloud).

**Why:** User experienced 1-10 second typing delay on chart-heavy documents. Root causes: (1) destructured store subscriptions causing full Editor re-renders on every keystroke, (2) per-keystroke serialization of 60KB documents, (3) full tree refresh on every save via iCloud watcher events.

**How to apply:** When modifying Editor.tsx, chart/drawing components, or file watcher code, check store subscriptions and serialization paths.
